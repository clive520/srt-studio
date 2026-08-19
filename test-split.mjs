import { chromium } from 'playwright-core';

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] || 'http://localhost:4173';
const WAV = 'C:/opencode/srt-studio/test-fixtures/sine.wav';

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.route('**/api.groq.com/**', (route) => {
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

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
};

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.fill('.key-label input', 'fake');
await page.setInputFiles('#file-input', WAV);
await page.waitForFunction(() => {
  const b = document.querySelector('.file-bar .btn.primary');
  return b && !b.disabled;
}, { timeout: 20000 });
await page.click('.file-bar .btn.primary');
await page.waitForSelector('.tl-block', { timeout: 20000 });
await page.click('.tl-block >> nth=0');
await page.waitForTimeout(200);

// 情境 A：點「在游標處切分」按鈕（textarea 會失焦）——游標放中間
await page.fill('.main-edit textarea', '今天天氣很好');
await page.evaluate(() => {
  const ta = document.querySelector('.main-edit textarea');
  ta.focus();
  ta.setSelectionRange(4, 4);
});
await page.click('text=在游標處切分');
await page.waitForTimeout(300);
let blocks = await page.locator('.tl-block').count();
check('A) 點按鈕切分（游標中段，3 段）', blocks === 3, `blocks=${blocks}`);
const noticeA = await page.locator('.banner.info').textContent().catch(() => '');
check('A) 顯示切分成功提示', /已切分/.test(noticeA || ''), `notice=${noticeA}`);

// 情境 B：游標在文字結尾（邊界）→ 應自動 fallback 斷句，仍可切分
// activeIdx 仍為 0，直接更新文字並點按鈕（不特別設游標 → 邊界 → fallback）
await page.fill('.main-edit textarea', '今天天氣很好');
await page.waitForTimeout(200);
await page.click('text=在游標處切分');
await page.waitForTimeout(300);
blocks = await page.locator('.tl-block').count();
check('B) 游標在結尾仍可切分（fallback，段數增加）', blocks === 4, `blocks=${blocks}`);

console.log('\n=== RESULT ===');
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? 'ALL PASS' : `FAILED: ${failed.length}`, `(${results.length} checks)`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);