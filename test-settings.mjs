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

let sentStt = null;
let sentSeg = null;

await page.route('**/api/catalog', (route) => {
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ catalog: CATALOG }) });
});

await page.route('**/api/transcribe', (route) => {
  const s = route.request().postDataBuffer().toString('latin1');
  const field = (n) => {
    const m = s.match(new RegExp(`name="${n}"\\r\\n\\r\\n([^\\r\\n]+)`));
    return m ? m[1] : '';
  };
  sentStt = { provider: field('provider'), model: field('model'), key: field('key'), language: field('language') };
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
  const body = JSON.parse(route.request().postData() || '{}');
  sentSeg = { provider: body.provider, model: body.model, key: body.key };
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ boundaries: [2, 4] }) });
});

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
};

await page.goto(URL, { waitUntil: 'domcontentloaded' });

// 1. 設定面板：兩區各自說明（辨識模型／分段模型）
await page.click('text=🔧 模型設定');
await page.waitForSelector('.settings-card', { timeout: 10000 });
let cards = await page.locator('.settings-card').count();
check('設定面板有 2 區', cards === 2, `cards=${cards}`);
const intro = await page.locator('.settings-intro').textContent();
check(
  '說明「兩組模型、各別用自己的 Key」',
  intro.includes('兩組模型') && intro.includes('API Key'),
  intro
);
const descs = await page.locator('.settings-desc').allTextContents();
check(
  '辨識區說明（聲音變文字＋時間點）與分段區說明（句意切開）',
  descs[0].includes('逐字稿') && descs[0].includes('時間點') && descs[1].includes('句意'),
  JSON.stringify(descs)
);
const legend = await page.locator('.settings-legend').textContent();
check('圖例含免費額度與付費說明', legend.includes('免費額度') && legend.includes('付費'), legend);

// 2. 供應商切換 → 模型自動跟隨；Key 各自獨立
await page.selectOption('.settings-card >> nth=0 >> select >> nth=0', 'openai');
let model = await page.locator('.settings-card >> nth=0 >> select >> nth=1').inputValue();
check('辨識切到 OpenAI 後模型自動跟隨 whisper-1', model === 'whisper-1', model);
await page.fill('.settings-card >> nth=0 >> .key-label input', 'my-openai-key');
await page.fill('.settings-card >> nth=1 >> .key-label input', 'my-groq-seg-key');
const segKeyType = await page.locator('.settings-card >> nth=1 >> .key-label input').getAttribute('type');
check('Key 輸入預設為密碼隱藏', segKeyType === 'password', segKeyType);
await page.click('.settings-hint input[type=checkbox]');
const sttKeyType = await page.locator('.settings-card >> nth=0 >> .key-label input').getAttribute('type');
check('勾選後 Key 暫時顯示', sttKeyType === 'text', sttKeyType);
await page.click('.settings-foot .btn.primary');

// 3. 設定存在瀏覽器（localStorage），不上傳伺服器
const ls = await page.evaluate(() => ({
  stt: JSON.parse(localStorage.getItem('srt-studio:stt') || 'null'),
  seg: JSON.parse(localStorage.getItem('srt-studio:seg') || 'null'),
}));
check(
  'localStorage 存有兩把 Key（stt+seg）',
  ls.stt?.key === 'my-openai-key' && ls.seg?.key === 'my-groq-seg-key' && ls.stt?.provider === 'openai',
  JSON.stringify(ls)
);

// 4. 重新整理後設定仍在（徽章顯示）
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('.model-badge')];
  return b.some((x) => x.textContent.includes('OpenAI') && x.textContent.includes('Whisper-1'));
}, { timeout: 5000 });
const badgeText = await page.locator('.model-badge').allTextContents();
check(
  '重新整理後徽章顯示 OpenAI・Whisper-1 與分段設定',
  badgeText.some((t) => t.includes('OpenAI') && t.includes('Whisper-1')) && badgeText.some((t) => t.includes('DeepSeek V4 Flash')),
  JSON.stringify(badgeText)
);

// 5. 辨識請求帶上「使用者自己的」Key 與模型
await page.setInputFiles('#file-input', WAV);
await page.waitForFunction(() => {
  const b = document.querySelector('.file-bar .btn.primary');
  return b && !b.disabled;
}, { timeout: 20000 });
await page.click('.file-bar .btn.primary');
await page.waitForSelector('.tl-block', { timeout: 20000 });
check(
  '辨識請求帶 user 的 provider/model/key',
  sentStt?.provider === 'openai' && sentStt?.model === 'whisper-1' && sentStt?.key === 'my-openai-key',
  JSON.stringify(sentStt)
);
check(
  '分段請求帶 user 的分段模型與 Key',
  sentSeg?.provider === 'opencode-go' && sentSeg?.model === 'deepseek-v4-flash' && sentSeg?.key === 'my-groq-seg-key',
  JSON.stringify(sentSeg)
);

// 6. 沒填 Key 時 → 提示要先去模型設定
await page.click('.file-bar .btn:has-text("更換檔案")');
await page.setInputFiles('#file-input', WAV);
await page.waitForFunction(() => {
  const b = document.querySelector('.file-bar .btn.primary');
  return b && !b.disabled;
}, { timeout: 20000 });
await page.evaluate(() => localStorage.removeItem('srt-studio:stt'));
await page.click('text=🔧 模型設定');
await page.waitForSelector('.settings-card', { timeout: 10000 });
await page.fill('.settings-card >> nth=0 >> .key-label input', '');
await page.click('.settings-foot .btn.primary');
await page.click('.file-bar .btn.primary');
await page.waitForSelector('.banner.error', { timeout: 5000 });
const errText = await page.locator('.banner.error span').textContent();
check('未填辨識 Key → 提示前往模型設定', errText.includes('模型設定'), errText);

console.log('\n=== RESULT ===');
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? 'ALL PASS' : `FAILED: ${failed.length}`, `(${results.length} checks)`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);