import { chromium } from 'playwright-core';

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] || 'http://localhost:4173';
const WAV = 'C:/opencode/srt-studio/test-fixtures/sine.wav';

const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(`[console] ${m.text()}`);
});

await page.route('**/api.groq.com/**', (route) => {
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

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
};

await page.goto(URL, { waitUntil: 'domcontentloaded' });

await page.fill('.key-label input', 'fake-key');
await page.setInputFiles('#file-input', WAV);

await page.waitForFunction(() => {
  const b = document.querySelector('.file-bar .btn.primary');
  return b && !b.disabled;
}, { timeout: 20000 });
console.log('辨識按鈕已啟用');

await page.click('.file-bar .btn.primary');
await page.waitForSelector('.tl-block', { timeout: 20000 });
await page.waitForTimeout(1500);

const blockCount = await page.locator('.tl-block').count();
check('時間軸字幕塊產生（3 段）', blockCount === 3, `blockCount=${blockCount}`);

const waveExists = await page.locator('.tl-wave').count();
check('波形 canvas 存在', waveExists > 0);

const segTexts = await page.locator('.tl-block-text').allTextContents();
check('字幕塊內容', segTexts.length === 3 && segTexts[0] === '第一句。' && segTexts[1] === '第二句。' && segTexts[2] === '第三句。', JSON.stringify(segTexts));

const mbBefore = await page.locator('.media-box').isVisible();
await page.click('.media-head .icon-btn');
await page.waitForTimeout(200);
const mbHidden = !(await page.locator('.media-box').isVisible());
const restoreVisible = await page.locator('.restore-preview').isVisible();
await page.click('.restore-preview');
await page.waitForTimeout(200);
const mbAfter = await page.locator('.media-box').isVisible();
check('預覽可收合/展開', mbBefore && mbHidden && restoreVisible && mbAfter, `before=${mbBefore} hidden=${mbHidden} restore=${restoreVisible} after=${mbAfter}`);

await page.click('.tl-block >> nth=0');
await page.waitForTimeout(200);
const editText = await page.locator('.main-edit textarea').inputValue().catch(() => '');
check('點字幕塊後編輯面板顯示該段', editText === '第一句。', `text=${editText}`);

await page.fill('.main-edit textarea', '修改過的句子');
await page.waitForTimeout(200);
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);
const undoText = await page.locator('.main-edit textarea').inputValue();
check('Ctrl+Z 復原文字編輯', undoText === '第一句。', `undoText=${undoText}`);

await page.fill('.main-edit textarea', '今天天氣很好');
await page.evaluate(() => {
  const ta = document.querySelector('.main-edit textarea');
  ta.focus();
  ta.setSelectionRange(4, 4);
});
await page.keyboard.press('s');
await page.waitForTimeout(200);
const blockCount2 = await page.locator('.tl-block').count();
check('S 切分（4 段）', blockCount2 === 4, `blockCount2=${blockCount2}`);

await page.click('.tl-block >> nth=0');
await page.waitForTimeout(150);
await page.keyboard.press('m');
await page.waitForTimeout(200);
const blockCount3 = await page.locator('.tl-block').count();
check('M 合併下一段（3 段）', blockCount3 === 3, `blockCount3=${blockCount3}`);

await page.keyboard.press('?');
await page.waitForTimeout(200);
const modalVisible = await page.locator('.modal').isVisible().catch(() => false);
check('? 開啟快捷鍵說明', modalVisible);
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
const modalHidden = (await page.locator('.modal').count()) === 0;
check('Esc 關閉說明', modalHidden);

await page.keyboard.press('ArrowDown');
await page.waitForTimeout(150);
const activeBlock = await page.locator('.tl-block.active').count();
check('↓ 切換選段', activeBlock === 1, `active=${activeBlock}`);

check('無 JS 錯誤', errors.length === 0, errors.join(' | '));

console.log('\n=== RESULT ===');
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? 'ALL PASS' : `FAILED: ${failed.length}`, `(${results.length} checks)`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);