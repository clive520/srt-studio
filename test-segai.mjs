import { chromium } from 'playwright-core';

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] || 'http://localhost:4173';
const WAV = 'C:/opencode/srt-studio/test-fixtures/sine.wav';

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

// 轉錄 mock：6 個字詞。分段 mock（/api/segment）：
//   第 1 次（轉錄後自動跑）回 [2,6]；第 2 次（按鈕手動重跑）回 [2,4,6]（三句各一段）
let segCalls = 0;
await page.route('**/api/status', (route) => {
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      stt: { provider: 'groq', model: 'whisper-large-v3-turbo', providerName: 'Groq', modelName: 'Whisper large-v3-turbo', hasKey: true },
      seg: { provider: 'opencode-go', model: 'deepseek-v4-flash', providerName: 'OpenCode GO', modelName: 'DeepSeek V4 Flash', hasKey: true },
    }),
  });
});

await page.route('**/api/transcribe', (route) => {
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

// 一般使用者看不到 Key 輸入框與供應商選單，只看到模型徽章
const keyInputs = await page.locator('.key-label input').count();
check('前臺沒有 API Key 輸入框', keyInputs === 0, `keyInputs=${keyInputs}`);
const providerSelects = await page.locator('.settings select').count();
check('前臺只保留語言/輸出選單（無供應商選單）', providerSelects === 2, `selects=${providerSelects}`);
const badgeText = await page.locator('.model-badge').allTextContents();
check(
  '徽章顯示目前使用的模型（辨識＋分段）',
  badgeText.some((t) => t.includes('Whisper large-v3-turbo')) && badgeText.some((t) => t.includes('DeepSeek V4 Flash')),
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