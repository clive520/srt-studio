import { chromium } from 'playwright-core';

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] || 'http://localhost:4173';
const WAV = 'C:/opencode/srt-studio/test-fixtures/sine.wav';

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const CATALOG = {
  stt: [
    { id: 'groq', name: 'Groq', free: true, keyUrl: 'https://console.groq.com/keys', models: [{ id: 'whisper-large-v3-turbo', name: 'Whisper large-v3-turbo', note: '免費・支援逐字時間戳' }] },
    { id: 'openai', name: 'OpenAI', free: false, keyUrl: 'https://platform.openai.com/api-keys', models: [{ id: 'whisper-1', name: 'Whisper-1', note: '付費' }] },
    { id: 'assemblyai', name: 'AssemblyAI', free: false, keyUrl: 'https://www.assemblyai.com/app/account/api-keys', models: [{ id: 'universal', name: 'Universal', note: '有免費額度' }] },
  ],
  seg: [
    { id: 'groq', name: 'Groq', free: true, keyUrl: 'https://console.groq.com/keys', models: [{ id: 'groq/compound-mini', name: 'Compound Mini', note: '免費' }] },
    { id: 'opencode-go', name: 'OpenCode GO', free: false, keyUrl: 'https://opencode.ai/auth', models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', note: '預設' }] },
    { id: 'deepseek', name: 'DeepSeek 官方', free: false, keyUrl: 'https://platform.deepseek.com/api_keys', models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', note: '官方' }] },
    { id: 'gemini', name: 'Google Gemini', free: false, keyUrl: 'https://aistudio.google.com/apikey', models: [{ id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', note: '2026 現役' }] },
    { id: 'openai', name: 'OpenAI', free: false, keyUrl: 'https://platform.openai.com/api-keys', models: [{ id: 'gpt-4o-mini', name: 'GPT-4o mini', note: '付費' }] },
    { id: 'anthropic', name: 'Anthropic', free: false, keyUrl: 'https://console.anthropic.com/settings/keys', models: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', note: '付費' }] },
    { id: 'nvidia', name: 'NVIDIA', free: true, keyUrl: 'https://build.nvidia.com', models: [{ id: 'nvidia/nemotron-3-super-120b-a12b', name: 'Nemotron 3 Super 120B', note: '免費' }] },
  ],
};

await page.route('**/api/catalog', (route) => {
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ catalog: CATALOG }) });
});

await page.route('**/api/transcribe', (route) => {
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      text: '第一句。第二句。',
      words: [
        { word: '第一句', start: 0.0, end: 1.0 },
        { word: '。', start: 1.0, end: 1.05 },
        { word: '第二句', start: 1.4, end: 2.4 },
        { word: '。', start: 2.4, end: 2.45 },
      ],
      segments: [{ start: 0, end: 2.5, text: '第一句。第二句。' }],
    }),
  });
});

await page.route('**/api/segment', (route) => {
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ boundaries: [2, 4] }),
  });
});

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
};

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.click('text=🔧 模型設定');
await page.waitForSelector('.settings-card', { timeout: 10000 });
await page.fill('.settings-card >> nth=0 >> .key-label input', 'fake-stt-key');
await page.fill('.settings-card >> nth=1 >> .key-label input', 'fake-seg-key');
await page.click('.settings-foot .btn.primary');
await page.setInputFiles('#file-input', WAV);
await page.waitForFunction(() => {
  const b = document.querySelector('.file-bar .btn.primary');
  return b && !b.disabled;
}, { timeout: 20000 });
await page.click('.file-bar .btn.primary');
await page.waitForSelector('.tl-block', { timeout: 20000 });
await page.click('.tl-block >> nth=0');
await page.waitForTimeout(200);

// 情境 C：依逐字時間戳精準切分（不編輯文字，直接設游標）
// 第一段文字『第一句。』words：第一句[0,1.0]、。[1.0,1.05]
// 游標在『句』與『。』之間（caret 3）→ 切點應為真實字界 1.0
// （比例法會切在 0 + 1.25×3/4 = 0.94，兩者可區分）
await page.evaluate(() => {
  const ta = document.querySelector('.main-edit textarea');
  ta.focus();
  ta.setSelectionRange(3, 3);
});
await page.click('text=在游標處切分');
await page.waitForTimeout(300);
let blocks = await page.locator('.tl-block').count();
check('C) 依逐字時間切分（游標在字與字之間，3 段）', blocks === 3, `blocks=${blocks}`);
const endC = parseFloat(await page.locator('.main-edit-time input >> nth=1').inputValue());
check('C) 切點 = 真實字界時間 1.0s（非比例估計 0.94s）', Math.abs(endC - 1.0) < 0.04, `end=${endC} (比例法會是 0.94)`);
const noticeC = await page.locator('.banner.info').textContent().catch(() => '');
check('C) 提示依逐字時間切分', /逐字/.test(noticeC || ''), `notice=${noticeC}`);

// 情境 A：點「在游標處切分」按鈕（textarea 會失焦）——游標放中間
// （改文字會使逐字對應失效，驗證退回比例法仍正常）
await page.fill('.main-edit textarea', '今天天氣很好');
await page.evaluate(() => {
  const ta = document.querySelector('.main-edit textarea');
  ta.focus();
  ta.setSelectionRange(4, 4);
});
await page.click('text=在游標處切分');
await page.waitForTimeout(300);
blocks = await page.locator('.tl-block').count();
check('A) 點按鈕切分（游標中段，4 段）', blocks === 4, `blocks=${blocks}`);
const noticeA = await page.locator('.banner.info').textContent().catch(() => '');
check('A) 顯示切分成功提示', /已切分/.test(noticeA || ''), `notice=${noticeA}`);

// 情境 B：游標在文字結尾（邊界）→ 應自動 fallback 斷句，仍可切分
// activeIdx 仍為 0，直接更新文字並點按鈕（不特別設游標 → 邊界 → fallback）
await page.fill('.main-edit textarea', '今天天氣很好');
await page.waitForTimeout(200);
await page.click('text=在游標處切分');
await page.waitForTimeout(300);
blocks = await page.locator('.tl-block').count();
check('B) 游標在結尾仍可切分（fallback，段數增加）', blocks === 5, `blocks=${blocks}`);

console.log('\n=== RESULT ===');
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? 'ALL PASS' : `FAILED: ${failed.length}`, `(${results.length} checks)`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);