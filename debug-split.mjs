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
await page.waitForTimeout(300);

const before = await page.evaluate(() => {
  const ta = document.querySelector('.main-edit textarea');
  ta.focus();
  ta.setSelectionRange(3, 3);
  return {
    taValue: ta.value,
    selStart: ta.selectionStart,
    activeEl: document.activeElement?.tagName,
  };
});
console.log('before split:', JSON.stringify(before));

await page.click('text=在游標處切分');
await page.waitForTimeout(300);

const notice = await page.locator('.banner.info').textContent().catch(() => '');
console.log('notice:', notice);
const errorBanner = await page.locator('.banner.error').textContent().catch(() => '');
console.log('error banner:', errorBanner);

const dumpBlocks = async () => {
  const n = await page.locator('.tl-block').count();
  const out = [];
  for (let i = 0; i < n; i++) {
    await page.click(`.tl-block >> nth=${i}`);
    await page.waitForTimeout(50);
    const start = await page.locator('.main-edit-time input >> nth=0').inputValue();
    const end = await page.locator('.main-edit-time input >> nth=1').inputValue();
    const text = await page.locator('.main-edit textarea').inputValue();
    out.push({ i, start, end, text });
  }
  return out;
};

const blocksAfter = await dumpBlocks();
console.log('blocks after split:', JSON.stringify(blocksAfter));

await browser.close();
process.exit(0);