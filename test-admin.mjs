import { chromium } from 'playwright-core';

const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] || 'http://localhost:4173';
const PASSWORD = 'secret123';

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

// 伺服器端狀態（模擬 Vercel KV）
let stt = { provider: 'groq', model: 'whisper-large-v3-turbo', key: 'k-groq' };
let seg = { provider: 'opencode-go', model: 'deepseek-v4-flash', key: 'k-go' };

const CATALOG = {
  stt: [
    { id: 'groq', name: 'Groq', free: true, keyUrl: 'https://console.groq.com/keys', models: [{ id: 'whisper-large-v3-turbo', name: 'Whisper large-v3-turbo', note: '免費' }] },
    { id: 'openai', name: 'OpenAI', free: false, keyUrl: 'https://platform.openai.com/api-keys', models: [{ id: 'whisper-1', name: 'Whisper-1', note: '付費' }] },
  ],
  seg: [
    { id: 'opencode-go', name: 'OpenCode GO', free: false, keyUrl: 'https://opencode.ai/auth', models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', note: '預設' }] },
    { id: 'deepseek', name: 'DeepSeek 官方', free: false, keyUrl: 'https://platform.deepseek.com/api_keys', models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', note: '官方' }] },
    { id: 'groq', name: 'Groq', free: true, keyUrl: 'https://console.groq.com/keys', models: [{ id: 'groq/compound-mini', name: 'Compound Mini', note: '免費' }] },
  ],
};

const pub = (role, d) => {
  const p = CATALOG[role].find((x) => x.id === d.provider);
  const m = p?.models.find((x) => x.id === d.model);
  return { provider: d.provider, model: d.model, providerName: p?.name || d.provider, modelName: m?.name || d.model, hasKey: !!d.key };
};

await page.route('**/api/status', (route) => {
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ stt: pub('stt', stt), seg: pub('seg', seg) }),
  });
});

await page.route('**/api/admin', async (route) => {
  const headers = route.request().headers();
  const authOk = headers['x-admin-password'] === PASSWORD;
  if (route.request().method() === 'PUT') {
    if (!authOk) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: '密碼錯誤' }) });
    const body = JSON.parse(route.request().postData() || '{}');
    for (const role of ['stt', 'seg']) {
      const r = body[role];
      if (!r) continue;
      const p = CATALOG[role].find((x) => x.id === r.provider);
      if (!p || !p.models.some((m) => m.id === r.model)) {
        return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: '不支援的模型組合' }) });
      }
      if (role === 'stt') stt = { provider: r.provider, model: r.model, key: r.key && r.key !== '******' ? r.key : stt.key };
      else seg = { provider: r.provider, model: r.model, key: r.key && r.key !== '******' ? r.key : seg.key };
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  }
  // GET
  if (!authOk) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: '密碼錯誤' }) });
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ stt, seg, password: '', catalog: CATALOG }),
  });
});

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
};

await page.goto(`${URL}/#admin`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.admin-login', { timeout: 10000 });
check('進入 #admin 顯示登入畫面', true);

// 錯誤密碼 → 顯示錯誤
await page.fill('.admin-login-row input', 'wrong');
await page.click('text=進入後台');
await page.waitForSelector('.banner.error', { timeout: 5000 });
check('錯誤密碼 → 顯示錯誤', true);

// 正確密碼 → 顯示設定表單，且帶出目前設定
await page.fill('.admin-login-row input', PASSWORD);
await page.click('text=進入後台');
await page.waitForSelector('.admin-card', { timeout: 5000 });
let cards = await page.locator('.admin-card').count();
check('登入後顯示 2 張設定卡（辨識＋分段）', cards === 2, `cards=${cards}`);

const segProv = await page.locator('.admin-card >> nth=1 >> select >> nth=0').inputValue();
const segModel = await page.locator('.admin-card >> nth=1 >> select >> nth=1').inputValue();
check('分段卡目前設定 = OpenCode GO / deepseek-v4-flash', segProv === 'opencode-go' && segModel === 'deepseek-v4-flash', `${segProv}/${segModel}`);

const sttProv = await page.locator('.admin-card >> nth=0 >> select >> nth=0').inputValue();
check('辨識卡目前設定 = Groq', sttProv === 'groq', sttProv);

// 切換分段供應商 → 模型自動跳到該供應商第一個模型
await page.selectOption('.admin-card >> nth=1 >> select >> nth=0', 'deepseek');
const segModel2 = await page.locator('.admin-card >> nth=1 >> select >> nth=1').inputValue();
check('切換供應商後模型自動跟隨（deepseek-v4-flash）', segModel2 === 'deepseek-v4-flash', segModel2);

await page.click('.admin-card >> nth=1 >> .btn.primary');
await page.waitForSelector('.admin-save .ok', { timeout: 5000 });
check('儲存成功提示', true);

// 回主頁：徽章應顯示新的分段模型（DeepSeek 官方）
await page.evaluate(() => { window.location.hash = '#/'; });
await page.waitForFunction(() => {
  const t = document.querySelectorAll('.model-badge');
  return t.length === 2 && [...t].some((b) => b.textContent.includes('DeepSeek 官方'));
}, { timeout: 5000 });
const badgeText = await page.locator('.model-badge').allTextContents();
check(
  '主頁徽章更新為 DeepSeek 官方・DeepSeek V4 Flash',
  badgeText.some((t) => t.includes('DeepSeek 官方') && t.includes('DeepSeek V4 Flash')),
  JSON.stringify(badgeText)
);

// 主頁有系統設定入口，且無 Key 輸入框
const adminLink = await page.locator('a[href="#admin"]').count();
check('主頁有「系統設定」入口', adminLink === 1, `links=${adminLink}`);
const keyInputs = await page.locator('.key-label input').count();
check('一般頁面沒有 Key 輸入框', keyInputs === 0, `keyInputs=${keyInputs}`);

console.log('\n=== RESULT ===');
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? 'ALL PASS' : `FAILED: ${failed.length}`, `(${results.length} checks)`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);