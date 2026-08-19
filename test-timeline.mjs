import { chromium } from 'playwright-core';

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] || 'http://localhost:4173';
const WAV = 'C:/opencode/srt-studio/test-fixtures/sine.wav';

const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
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
await page.click('.file-bar .btn.primary');
await page.waitForSelector('.tl-block', { timeout: 20000 });
await page.waitForTimeout(1500);

// 等待波形畫出（任一位元組非透明）
await page.waitForFunction(() => {
  const c = document.querySelector('.tl-wave');
  if (!c) return false;
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 50) return true;
  return false;
}, { timeout: 20000 });

// 放大 3 級（40 → 80 → 160 → 320px/s），讓內容寬度超過視窗可捲動
for (let i = 0; i < 3; i++) {
  await page.click('.tl-zoom button[title="放大"]');
  await page.waitForTimeout(250);
}

const handleCount = await page.locator('.tl-block-handle').count();
check('字幕塊有左右拖曳把手（每塊 2 個）', handleCount === 6, `handles=${handleCount}`);

// ---- 拖曳右邊緣：拉長第一段 ----
const b0 = await page.locator('.tl-block >> nth=0').boundingBox();
const midY = b0.y + b0.height / 2;
const endBefore = parseFloat(await page.locator('.main-edit-time input >> nth=1').inputValue());
await page.mouse.move(b0.x + b0.width - 3, midY);
await page.mouse.down();
await page.mouse.move(b0.x + b0.width + 80, midY, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(300);
let endVal = parseFloat(await page.locator('.main-edit-time input >> nth=1').inputValue());
check('拖曳右邊緣拉長（end +0.25s）', Math.abs(endVal - (endBefore + 0.25)) < 0.05, `end=${endVal} (before=${endBefore})`);

// ---- 拖曳左邊緣：把第二段起點提早 ----
const b1 = await page.locator('.tl-block >> nth=1').boundingBox();
const midY1 = b1.y + b1.height / 2;
await page.mouse.click(b1.x + b1.width / 2, midY1); // 先選中第二段，讀取原本起點
await page.waitForTimeout(200);
const startBefore = parseFloat(await page.locator('.main-edit-time input >> nth=0').inputValue());
await page.mouse.move(b1.x + 3, midY1);
await page.mouse.down();
await page.mouse.move(b1.x - 64, midY1, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(300);
let startVal = parseFloat(await page.locator('.main-edit-time input >> nth=0').inputValue());
check('拖曳左邊緣提早（start -0.2s）', Math.abs(startVal - (startBefore - 0.2)) < 0.05, `start=${startVal} (before=${startBefore})`);

// ---- 捲動後波形與字幕塊仍對齊 ----
// 音檔只有 3.0s~3.2s 有聲（=320px/s 時內容座標 960~1024），其餘靜音：
// 捲動 400 後，若波形與字幕塊對齊，內容座標 960 應畫有波形（alpha>50），
// 而內容座標 560（= 捲動前 960 的位置）應保持空白（alpha<50，代表波形沒被拖走）。
await page.evaluate(() => {
  document.querySelector('.tl-scroll').scrollTo({ left: 400, behavior: 'auto' });
});
await page.waitForFunction(() => document.querySelector('.tl-scroll').scrollLeft === 400, { timeout: 5000 });
await page.waitForTimeout(500);
const align = await page.evaluate(() => {
  const content = document.querySelector('.tl-content');
  const block = document.querySelector('[data-index="2"]');
  const canvas = document.querySelector('.tl-wave');
  const scroll = document.querySelector('.tl-scroll');
  const cRect = content.getBoundingClientRect();
  const bRect = block.getBoundingClientRect();
  const xScale = canvas.width / canvas.clientWidth;
  const yScale = canvas.height / canvas.clientHeight;
  const ctx = canvas.getContext('2d');
  // 取中間偏上的一列：避開靜音時畫在中線的 1px 細線，但仍在音波的振幅範圍內
  const y = Math.floor(20 * yScale);
  const a = (x) => ctx.getImageData(Math.floor(x * xScale), y, 1, 1).data[3];
  return {
    toneAlpha: a(960),
    shiftedAlpha: a(560),
    scrollLeft: scroll.scrollLeft,
    inView: bRect.left >= cRect.left && bRect.right <= cRect.right,
  };
});
check(
  '捲動 400px 後波形仍在正確位置（對齊，未位移）',
  align.inView && align.scrollLeft === 400 && align.toneAlpha > 50 && align.shiftedAlpha < 50,
  `toneAlpha=${align.toneAlpha} shiftedAlpha=${align.shiftedAlpha} scroll=${align.scrollLeft} inView=${align.inView}`
);

// ---- 播放頭順暢移動（rAF 驅動，不再跳格） ----
await page.evaluate(() => {
  document.querySelector('.tl-scroll').scrollTo({ left: 0, behavior: 'auto' });
  const m = document.querySelector('audio, video');
  m.muted = true;
  m.currentTime = 0;
  m.play();
});
const samples = [];
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(60);
  samples.push(parseFloat(await page.evaluate(() => document.querySelector('.tl-playhead').style.left)));
}
await page.evaluate(() => document.querySelector('audio, video').pause());
const distinct = new Set(samples.filter((v) => !Number.isNaN(v))).size;
const advanced = samples[samples.length - 1] > samples[0];
check(
  '播放時播放頭順暢移動（多個不同位置，非跳格）',
  distinct >= 6 && advanced,
  `distinct=${distinct} samples=[${samples.map((s) => s.toFixed(0)).join(',')}]`
);

check('無 JS 錯誤', errors.length === 0, errors.join(' | '));

console.log('\n=== RESULT ===');
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? 'ALL PASS' : `FAILED: ${failed.length}`, `(${results.length} checks)`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);