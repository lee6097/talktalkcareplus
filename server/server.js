const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const OpenAI = require('openai');
const path = require('path');
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const app = express();
app.use(cors({
  origin: 'https://lee6097.github.io'
}));
app.use(bodyParser.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const systemPrompt = process.env.SYSTEM_PROMPT;  // ⬅️ 시스템 프롬프트 추가

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

// index.html 전송 (조회수 증가 없음)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

// 조회수 증가 API
app.get('/view', async (req, res) => {
  pageViews++;
  await updateMetrics();
  console.log('Page Views:', pageViews);
  res.sendStatus(200);
});

// 메시지 처리 API (GPT 응답 포함)
app.post('/chat', async (req, res) => {
  messageCount++;
  await updateMetrics();
  console.log('Message Count:', messageCount);

  const { messages } = req.body;

  const fullMessages = [
    { role: "system", content: systemPrompt },  // 시스템 프롬프트 추가
    ...messages
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1',  // 모델 이름 변경
      messages: fullMessages
    });
    res.json({ reply: completion.choices[0].message.content });
  } catch (err) {
    console.error(err);
    res.status(500).send('OpenAI 오류');
  }
});

// 관리자 통계 확인 API
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

// 서버 시작
async function startServer() {
  await initializeMetrics();
  app.listen(3000, () => {
    console.log('✅ 서버가 3000번 포트에서 실행 중입니다');
  });
}

startServer();
