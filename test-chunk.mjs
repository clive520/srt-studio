// 真實分段上傳辨識（ffmpeg wasm 壓縮＋切割）端到端測試：
// 合成 49 秒 wav（>4.2MB）→ 觸發 prepareUpload 壓縮 → 切成 3 塊（16s/16s/17s）
// → /api/transcribe 被呼叫 3 次 → 各塊時間戳偏移合併 → 段界時間正確
import { chromium } from 'playwright-core';

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] || 'http://localhost:4173';

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

// 只注入「每塊上限」參數（100KB），讓小音檔也能切成多塊；其餘走真實預設
await page.addInitScript(() => {
  window.__SRT_TEST_OPTS__ = { compressThreshold: 4.2 * 1024 * 1024, chunkMaxBytes: 100 * 1024 };
});

const CATALOG = {
  stt: [
    { id: 'groq', name: 'Groq', free: true, keyUrl: 'https://console.groq.com/keys', models: [{ id: 'whisper-large-v3-turbo', name: 'Whisper large-v3-turbo', note: '免費・支援逐字時間戳' }] },
    { id: 'openai', name: 'OpenAI', free: false, keyUrl: 'https://platform.openai.com/api-keys', models: [{ id: 'whisper-1', name: 'Whisper-1', note: '付費' }] },
  ],
  seg: [
    { id: 'opencode-go', name: 'OpenCode GO', free: false, keyUrl: 'https://opencode.ai/auth', models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', note: '預設' }] },
  ],
};

let transcribeCalls = 0;
const sentFilenames = [];

await page.route('**/api/catalog', (route) => {
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ catalog: CATALOG }) });
});

await page.route('**/api/transcribe', (route) => {
  const s = route.request().postDataBuffer().toString('latin1');
  const m = s.match(/filename="([^"]+)"/);
  sentFilenames.push(m ? m[1] : '?');
  transcribeCalls++;
  // 每塊都回「區域時間」（0 起算），合併時應被 +16s / +32s
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      text: '你好你好',
      words: [
        { word: '你', start: 0.0, end: 0.4 },
        { word: '好', start: 0.5, end: 0.9 },
      ],
      segments: [{ start: 0, end: 0.9, text: '你好' }],
    }),
  });
});

await page.route('**/api/segment', (route) => {
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ boundaries: [1, 3, 5] }) });
});

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
};

await page.goto(URL, { waitUntil: 'domcontentloaded' });

// 填兩把 Key（預設供應商即可）
await page.click('text=🔧 模型設定');
await page.waitForSelector('.settings-card', { timeout: 10000 });
await page.fill('.settings-card >> nth=0 >> .key-label input', 'test-stt-key');
await page.fill('.settings-card >> nth=1 >> .key-label input', 'test-seg-key');
await page.click('.settings-foot .btn.primary');

// 合成 54 秒 44100Hz 16bit 單聲道 wav（≈4.54MB > 4.2MB 壓縮門檻）
const synthWav = await page.evaluate(() => {
  const SEC = 54;
  const SR = 44100;
  const n = SEC * SR;
  const ab = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(ab);
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); wstr(8, 'WAVE');
  wstr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, SR, true); dv.setUint32(28, SR * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  wstr(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const v = Math.sin((2 * Math.PI * 440 * i) / SR) * 0.25 * 32767;
    dv.setInt16(44 + i * 2, v, true);
  }
  const file = new File([ab], 'long.wav', { type: 'audio/wav' });
  const input = document.getElementById('file-input');
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return file.size;
});
check('合成 wav > 4.2MB（觸發壓縮）', synthWav > 4.2 * 1024 * 1024, `${(synthWav / 1024 / 1024).toFixed(2)}MB`);

// 等「辨識」按鈕可用後按下
await page.waitForFunction(() => {
  const b = document.querySelector('.file-bar .btn.primary');
  return b && !b.disabled;
}, { timeout: 30000 });
await page.click('.file-bar .btn.primary');

// ffmpeg wasm 下載＋編碼＋分段需要時間，等辨識完成（最多 90 秒）
await page.waitForSelector('.tl-block', { timeout: 90000 });
await page.waitForFunction(() => !document.querySelector('.file-bar .btn.primary')?.disabled, { timeout: 90000 });

check('分段後 /api/transcribe 被呼叫 4 次', transcribeCalls === 4, `calls=${transcribeCalls}`);
check('四塊檔名為 chunk_000~003', JSON.stringify(sentFilenames) === JSON.stringify(['chunk_000.mp3', 'chunk_001.mp3', 'chunk_002.mp3', 'chunk_003.mp3']), JSON.stringify(sentFilenames));

// 合併後 8 個字詞（每塊 2 個），AI 分段 [1,3,5] → 4 段：
// [你0] [好0.5+你17] [好17.5+你34] [好34.5+你51+好51.5]
// 跨塊的長段（16.9s/17.4s）會被 splitLongSegments 在最大停頓處切開 →
// 你0 | 好0.5 | 你17 | 好17.5 | 你34 | 好34.5 | 你好51 = 7 段
// 關鍵：第二塊之後的字詞時間已被偏移 +17s / +34s / +51s
const times = await page.evaluate(() => {
  const blocks = [...document.querySelectorAll('.tl-block')];
  return blocks.map((b) => b.getAttribute('title') || '');
});
const parseStart = (t) => {
  const m = /^([\d:,]+)\s*→/.exec(t);
  if (!m) return null;
  const p = m[1].replace(',', '.').split(':');
  if (p.length !== 3) return null;
  return +p[0] * 3600 + +p[1] * 60 + parseFloat(p[2]);
};
const starts = times.map((t) => parseStart(t)).filter((x) => x !== null);
check('共 7 段', times.length === 7, `blocks=${times.length}`);
check(
  '第三段起點 = 第二塊偏移 17s',
  starts.length >= 4 && Math.abs(starts[2] - 17) < 0.2,
  JSON.stringify(starts)
);
check('第五段起點 = 第三塊偏移 34s', starts.length >= 4 && Math.abs(starts[4] - 34) < 0.2, JSON.stringify(starts));
check('第七段起點 = 第四塊偏移 51s', starts.length >= 7 && Math.abs(starts[6] - 51) < 0.2, JSON.stringify(starts));
check('無 JS 錯誤', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200));

console.log('\n=== RESULT ===');
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? 'ALL PASS' : `FAILED: ${failed.length}`, `(${results.length} checks)`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);