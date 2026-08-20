import { chromium } from 'playwright-core';

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] || 'http://localhost:4173';
const WAV = 'C:/opencode/srt-studio/test-fixtures/sine.wav';

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

// 轉錄 mock：6 個字詞。分段 mock（/api/segment）：
//   第 1 次（轉錄後自動跑）回 [2,6]；第 2 次（按鈕手動重跑）回 [2,4,6]（三句各一段）
const CATALOG = {
  stt: [
    { id: 'groq', name: 'Groq', free: true, keyUrl: 'https://console.groq.com/keys', models: [{ id: 'whisper-large-v3-turbo', name: 'Whisper large-v3-turbo', note: '免費・支援逐字時間戳' }] },
    { id: 'openai', name: 'OpenAI', free: false, keyUrl: 'https://platform.openai.com/api-keys', models: [{ id: 'whisper-1', name: 'Whisper-1', note: '付費' }] },
  ],
  seg: [
    { id: 'groq', name: 'Groq', free: true, keyUrl: 'https://console.groq.com/keys', models: [{ id: 'groq/compound-mini', name: 'Compound Mini', note: '免費' }] },
    { id: 'opencode-go', name: 'OpenCode GO', free: false, keyUrl: 'https://opencode.ai/auth', models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', note: '預設' }] },
  ],
};

let segCalls = 0;
let segBodyOk = false;
let transcribeFieldsOk = false;
await page.route('**/api/catalog', (route) => {
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ catalog: CATALOG }) });
});

await page.route('**/api/transcribe', (route) => {
  const s = route.request().postDataBuffer().toString('latin1');
  transcribeFieldsOk =
    /name="provider"\r\n\r\ngroq\r\n/.test(s) &&
    /name="model"\r\n\r\nwhisper-large-v3-turbo\r\n/.test(s) &&
    /name="key"\r\n\r\nfake-stt-key\r\n/.test(s) &&
    /name="language"\r\n\r\nauto\r\n/.test(s);
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      text: '第一句。第二句。第三句。',
      words: [
        { word: '第一句', start: 0.0, end: 1.0 },
        { word: '。', start: 1.0, end: 1.05 },
        { word: '第二句', start: 1.4, end: 2.4 },
        { word: '。', start: 2.4, end: 2.45 },
        { word: '第三句', start: 2.9, end: 3.8 },
        { word: '。', start: 3.8, end: 3.85 },
      ],
      segments: [{ start: 0, end: 3.9, text: '第一句。第二句。第三句。' }],
    }),
  });
});

await page.route('**/api/segment', (route) => {
  segCalls++;
  const body = JSON.parse(route.request().postData() || '{}');
  segBodyOk =
    body.provider === 'opencode-go' &&
    body.model === 'deepseek-v4-flash' &&
    body.key === 'fake-seg-key' &&
    Array.isArray(body.words) &&
    body.words.length === 6;
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ boundaries: segCalls === 1 ? [2, 6] : [2, 4, 6] }),
  });
});

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
};

await page.goto(URL, { waitUntil: 'domcontentloaded' });

// 一般使用者看不到 Key 輸入框（在模型設定面板內），只看到模型徽章
const keyInputs = await page.locator('.key-label input').count();
check('主頁面沒有 API Key 輸入框', keyInputs === 0, `keyInputs=${keyInputs}`);
const providerSelects = await page.locator('.settings select').count();
check('主頁只保留語言/輸出選單（無供應商選單）', providerSelects === 2, `selects=${providerSelects}`);
await page.waitForFunction(() => document.querySelectorAll('.model-badge').length === 2, { timeout: 5000 });
let badgeText = await page.locator('.model-badge').allTextContents();
check(
  '徽章顯示目前設定（辨識＋分段，未填 Key 有提示）',
  badgeText.some((t) => t.includes('Whisper large-v3-turbo') && t.includes('未填 Key')) &&
    badgeText.some((t) => t.includes('DeepSeek V4 Flash') && t.includes('未填 Key')),
  JSON.stringify(badgeText)
);

// 開啟模型設定：兩張卡（辨識＋分段）、免費/付費標示
await page.click('text=🔧 模型設定');
await page.waitForSelector('.settings-card', { timeout: 10000 });
let cards = await page.locator('.settings-card').count();
check('設定面板有 2 張卡（聲音變文字＋句子分段）', cards === 2, `cards=${cards}`);
const optionText = await page.locator('.settings-card >> nth=0 >> select >> nth=0').locator('option').allTextContents();
check(
  '辨識供應商標示免費/付費（Groq（免費））',
  optionText.some((t) => t.includes('Groq') && t.includes('免費')),
  JSON.stringify(optionText)
);
const segOptionText = await page.locator('.settings-card >> nth=1 >> select >> nth=0').locator('option').allTextContents();
check(
  '分段供應商含免費（Groq/NVIDIA）與付費選項',
  segOptionText.some((t) => t.includes('Groq') && t.includes('免費')) && segOptionText.some((t) => t.includes('OpenCode GO') && t.includes('付費')),
  JSON.stringify(segOptionText)
);

// 填入兩把獨立的 Key（辨識一把、分段一把）
await page.fill('.settings-card >> nth=0 >> .key-label input', 'fake-stt-key');
await page.fill('.settings-card >> nth=1 >> .key-label input', 'fake-seg-key');
await page.click('.settings-foot .btn.primary');
await page.waitForFunction(() => document.querySelectorAll('.key-label input').length === 0, { timeout: 5000 });
badgeText = await page.locator('.model-badge').allTextContents();
check(
  '填 Key 後徽章不再顯示「未填 Key」',
  badgeText.some((t) => t.includes('Whisper large-v3-turbo') && !t.includes('未填')) &&
    badgeText.some((t) => t.includes('DeepSeek V4 Flash') && !t.includes('未填')),
  JSON.stringify(badgeText)
);

await page.setInputFiles('#file-input', WAV);
await page.waitForFunction(() => {
  const b = document.querySelector('.file-bar .btn.primary');
  return b && !b.disabled;
}, { timeout: 20000 });
await page.click('.file-bar .btn.primary');
// 轉錄完成後「AI 重新分段」應自動執行（不用再按按鈕）：
// AI 回傳段界 [2,6] → 2 段：段1「第一句。」[0,1.05]、段2「第二句。第三句。」[1.4,3.85]
await page.waitForFunction(() => document.querySelectorAll('.tl-block').length === 2, { timeout: 20000 });
await page.waitForTimeout(1500);

// 啟發式分段不會先出現又閃走；直接驗證自動 AI 分段的結果
let blocks = await page.locator('.tl-block').count();
check('轉錄後自動 AI 分段（不用手動按，2 段）', blocks === 2, `blocks=${blocks}`);
check('自動 AI 分段共呼叫 1 次', segCalls === 1, `segCalls=${segCalls}`);
check(
  '辨識請求帶上使用者自己的 provider/model/key/language',
  transcribeFieldsOk,
  'multipart fields'
);
check('分段請求帶上使用者自己的分段模型與 Key', segBodyOk, 'seg body');

// 驗證段界與時間：段2 起點 = 第二句真實開始 1.4s（不是啟發式比例）
await page.click('.tl-block >> nth=1');
await page.waitForTimeout(200);
const start1 = parseFloat(await page.locator('.main-edit-time input >> nth=0').inputValue());
const text1 = await page.locator('.main-edit textarea').inputValue();
check('段2 起點 = 第二句真實時間 1.4s', Math.abs(start1 - 1.4) < 0.05, `start=${start1}`);
check('段2 文字 = 第二句。第三句。', text1 === '第二句。第三句。', `text=${text1}`);

// 再次切分仍應可用逐字時間（words 有保留下來）
await page.evaluate(() => {
  const ta = document.querySelector('.main-edit textarea');
  ta.focus();
  ta.setSelectionRange(3, 3); // 「第二句|。第三句。」
});
await page.click('text=在游標處切分');
await page.waitForTimeout(300);
blocks = await page.locator('.tl-block').count();
check('AI 分段後仍可依逐字時間切分（3 段）', blocks === 3, `blocks=${blocks}`);
const end0 = parseFloat(await page.locator('.main-edit-time input >> nth=1').inputValue());
check('切點 = 句號字界 2.4s', Math.abs(end0 - 2.4) < 0.05, `end=${end0}`);

// 按鈕仍可手動重跑（AI 回 [2,4,6] → 3 段：第一句。/第二句。/第三句。）
await page.click('text=AI 重新分段');
await page.waitForFunction(() => document.querySelectorAll('.tl-block').length === 3, { timeout: 15000 });
blocks = await page.locator('.tl-block').count();
check('按鈕手動重跑仍有效（3 段）', blocks === 3, `blocks=${blocks}`);
await page.click('.tl-block >> nth=0');
await page.waitForTimeout(200);
const text0 = await page.locator('.main-edit textarea').inputValue();
check('重跑後段1 文字 = 第一句。', text0 === '第一句。', `text=${text0}`);

console.log('\n=== RESULT ===');
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? 'ALL PASS' : `FAILED: ${failed.length}`, `(${results.length} checks)`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);