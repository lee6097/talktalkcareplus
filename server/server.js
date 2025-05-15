const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const OpenAI = require('openai');
const path = require('path');
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

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
    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: messages,
    });
    res.json({ reply: completion.choices[0].message.content });
  } catch (err) {
    console.error(err);
    res.status(500).send('OpenAI 오류');
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
