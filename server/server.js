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
app.use(cors({ origin: 'https://lee6097.github.io' }));
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Supabase에 초기 데이터가 없으면 생성
async function ensureMetricsRow() {
  const { data, error } = await supabase
    .from('metricsplus')
    .select('*')
    .eq('id', 1)
    .single();

  if (error) {
    if (error.message.includes('no rows') || error.code === 'PGRST116') {
      const { error: insertError } = await supabase
        .from('metricsplus')
        .insert([{ id: 1, pageViews: 0, messageCount: 0 }]);

      if (insertError) {
        console.error('초기 데이터 삽입 실패:', insertError.message);
      } else {
        console.log('초기 metricsplus row 생성됨');
      }
    } else {
      console.error('초기화 오류:', error.message);
    }
  }
}

// 안전한 Supabase 증가 호출
async function incrementView() {
  const { error } = await supabase.rpc('increment_page_views');
  if (error) console.error('페이지 뷰 증가 오류:', error.message);
}

async function incrementMessageCount() {
  const { error } = await supabase.rpc('increment_message_count');
  if (error) console.error('메시지 수 증가 오류:', error.message);
}

async function getMetrics() {
  const { data, error } = await supabase.rpc('get_metrics');
  if (error) {
    console.error('메트릭 조회 오류:', error.message);
    return { pageViews: 0, messageCount: 0 };
  }
  return data[0] || { pageViews: 0, messageCount: 0 };
}

// 라우트
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

app.get('/view', async (req, res) => {
  await incrementView();
  res.sendStatus(200);
});

app.post('/chat', async (req, res) => {
  await incrementMessageCount();

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

app.get('/admin', async (req, res) => {
  const { password } = req.query;
  if (password !== ADMIN_PASSWORD) {
    return res.status(403).send('❌ 접근 불가');
  }

  const metrics = await getMetrics();
  res.json(metrics);
});

// 서버 시작
async function startServer() {
  await ensureMetricsRow(); // DB에 초기 row 생성
  app.listen(3000, () => {
    console.log('✅ 서버가 3000번 포트에서 실행 중입니다');
  });
}

startServer();
