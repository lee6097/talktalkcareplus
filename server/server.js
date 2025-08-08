const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const OpenAI = require('openai');
const path = require('path');
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');
const fetch = require('node-fetch');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // 보안 중요! 일반 공개 키 아님
);

const app = express();
app.use(cors({
  origin: 'https://lee6097.github.io'
}));
app.use(bodyParser.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const systemPrompt = process.env.SYSTEM_PROMPT;

// 메모리에서 관리되는 숫자
let pageViews = 0;
let messageCount = 0;

async function initializeMetrics() {
  const { data, error } = await supabase
    .from('metricsplus')
    .select('*')
    .eq('id', 1)
    .single();

  if (error) {
    if (error.message.includes('no rows returned')) {
      // id=1이 없으면 새로 삽입
      const { error: insertError } = await supabase
        .from('metricsplus')
        .insert([{ id: 1, pageViews: 0, messageCount: 0 }]);
      if (insertError) {
        console.error('데이터 삽입 오류:', insertError.message);
      } else {
        console.log('id = 1 데이터를 새로 삽입');
      }
    } else {
      console.error('초기화 오류:', error.message);
    }
  } else if (data) {
    pageViews = data.pageViews || 0;
    messageCount = data.messageCount || 0;
    console.log('Supabase 초기화 완료:', { pageViews, messageCount });
  }
}

async function updateMetrics() {
  const { error } = await supabase
    .from('metricsplus')
    .update({ pageViews, messageCount })
    .eq('id', 1);

  if (error) console.error('Supabase 업데이트 오류:', error.message);
}

// 기존 루트 경로 (조회수 증가 제거)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

// 새로 추가: 조회수 증가 전용 API
app.get('/view', async (req, res) => {
  pageViews++;
  await updateMetrics();
  console.log('Page Views:', pageViews);
  res.sendStatus(200);
});

app.post('/chat', async (req, res) => {
  messageCount++;
  await updateMetrics();
  console.log('Message Count:', messageCount);
  const { messages } = req.body;

  try {
    // 1. [AI의 1차 판단] 먼저 평소처럼 답변을 생성합니다.
    const initialMessages = [
      { role: "system", content: systemPrompt },
      ...messages
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-5',
      messages: initialMessages,
    });

    // 챗봇이 생성한 답변을 'reply' 변수에 저장합니다.
    let reply = completion.choices[0].message.content;

    // 2. [AI의 2차 판단] 지금이 최종 답변 타이밍인지 AI에게 직접 물어봅니다.
    const metaAnalysisMessages = [
      ...initialMessages,
      { role: 'assistant', content: reply }, // 방금 생성한 답변까지 대화에 포함
      {
        role: 'user',
        content: "위 대화는 상담 대화가 끝난 상태(1:의학 관련 최종 답변이나 조언이 제시되고, 2:대화 초기화가 언급된 상태. 1과 2가 모두 충족)인가요? '네' 또는 '아니오'로만 명확하게 답해주세요."
      }
    ];

    const metaCompletion = await openai.chat.completions.create({
      model: 'gpt-5-mini',
      messages: metaAnalysisMessages,
      max_tokens: 5
    });

    const isFinalAnswer = metaCompletion.choices[0].message.content.includes('네');

    // AI가 '최종 답변'이라고 판단한 경우에만 출처 검색을 시작합니다.
    if (isFinalAnswer) {
      // console.log("AI가 최종 답변으로 판단하여 출처 검색을 시작합니다.");

      // 3. [AI의 3차 판단] 전체 대화를 바탕으로 '핵심 검색어'를 생성하도록 요청합니다.
      const querySynthesisMessages = [
        ...initialMessages,
        { role: 'assistant', content: reply },
        {
          role: 'user',
          content: "참고문헌을 검색하기 위해, 위 대화 전체의 핵심 의학주제(특히 마지막 답변 중심)를 1~5단어의 적절한 영어 구글검색어로 제시해줘. 다른 말 필요없고 딱 검색어만 제시해줘."
        }
      ];

      const queryCompletion = await openai.chat.completions.create({
        model: 'gpt-5-mini',
        messages: querySynthesisMessages,
        max_tokens: 20
      });

      // AI가 따옴표 등 불필요한 문자를 포함할 수 있으니 제거해줍니다.
      const searchQuery = queryCompletion.choices[0].message.content.replace(/["'\.]/g, '').trim();

      // ✅ [수정됨] 개인정보가 포함될 수 있는 검색어 로그를 주석 처리
      // console.log(`AI가 생성한 검색어: "${searchQuery}"`);

      // 4. AI가 만들어준 핵심 검색어로 구글 검색을 실행합니다.
      const searchResponse = await google.customsearch('v1').cse.list({
        auth: process.env.GOOGLE_API_KEY,
        cx: process.env.SEARCH_ENGINE_ID,
        q: searchQuery,
        num: 3
      });

      // 구글 검색 결과 전체를 'searchResults' 상자에 담습니다.
      const searchResults = searchResponse.data.items;

      // 검색 결과가 하나라도 있다면,
      if (searchResults && searchResults.length > 0) {

        // 5. 찾은 출처들을 번호가 매겨진 목록으로 만듭니다.
        const sourceList = searchResults
          .map((item, index) => `${index + 1}. ${item.link}`)
          .join('\n'); // 각 링크를 줄바꿈(\n)으로 연결합니다.

        console.log(`찾은 출처 목록:\n${sourceList}`);

        // 6. 기존 답변의 맨 뒤에, 완성된 출처 목록을 덧붙입니다.
        reply += `\n\n---\n참고문헌:\n${sourceList}`;
      }
    }

    // 7. 최종적으로 완성된 답변을 사용자에게 보냅니다.
    res.json({ reply: reply });

  } catch (err) {
    // ✅ [수정됨] 에러 객체 전체 대신, 에러 메시지만 안전하게 기록
    console.error('채팅 처리 중 오류 발생:', err.message);
    res.status(500).send('서버 오류 발생');
  }
});

// 관리자만 볼 수 있는 페이지
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

app.get('/admin', (req, res) => {
  const { password } = req.query;
  if (password !== ADMIN_PASSWORD) {
    return res.status(403).send('❌ 접근 불가');
  }
  res.json({
    pageViews,
    messageCount
  });
});

// 서버를 시작하는 함수
async function startServer() {
  await initializeMetrics(); // Supabase에서 값을 불러오는 비동기 함수
  app.listen(3000, () => {
    console.log('✅ 서버가 3000번 포트에서 실행 중입니다');
  });
}

startServer(); // 서버 시작
