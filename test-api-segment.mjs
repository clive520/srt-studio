// 真實 api/segment.js handler 的本機測試：JSON body + fetch stub
import { Readable } from 'node:stream';
import handler from './api/segment.js';

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
};

function makeReq(body) {
  const r = Readable.from([Buffer.from(JSON.stringify(body))], { objectMode: false });
  r.method = 'POST';
  r.headers = { 'content-type': 'application/json' };
  return r;
}

function makeRes() {
  const res = {
    _status: 0,
    headers: {},
    body: '',
    status(code) {
      this._status = code;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(s) {
      this.body = s;
    },
  };
  return res;
}

function call(body) {
  return new Promise((resolve, reject) => {
    const res = makeRes();
    handler(makeReq(body), res)
      .then(() => resolve(res))
      .catch(reject);
  });
}

const words = [
  { word: '第一句', start: 0.0, end: 1.0 },
  { word: '。', start: 1.0, end: 1.05 },
  { word: '第二句', start: 1.4, end: 2.4 },
  { word: '。', start: 2.4, end: 2.45 },
];

// 1. 正常：opencode-go + deepseek-v4-flash + key
let sent = null;
globalThis.fetch = async (url, opts) => {
  sent = { url, headers: opts.headers, body: JSON.parse(opts.body) };
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: '{"boundaries":[2,4]}' } }],
    }),
  };
};
let res = await call({ provider: 'opencode-go', model: 'deepseek-v4-flash', key: 'sk-go', words });
check('正常請求回 200 + boundaries', res._status === 200 && JSON.parse(res.body).boundaries?.length === 2, res.body);
check('轉送 OpenCode GO chat/completions', sent?.url === 'https://opencode.ai/zen/go/v1/chat/completions', sent?.url);
check('轉送帶使用者 key', sent?.headers?.Authorization === 'Bearer sk-go', '');
check('模型 = deepseek-v4-flash', sent?.body?.model === 'deepseek-v4-flash', '');

// 2. Anthropic kind：x-api-key 格式
globalThis.fetch = async (url, opts) => {
  sent = { url, headers: opts.headers, body: JSON.parse(opts.body) };
  return { ok: true, json: async () => ({ content: [{ type: 'text', text: '{"boundaries":[2,4]}' }] }) };
};
res = await call({ provider: 'anthropic', model: 'claude-sonnet-4-6', key: 'sk-ant', words });
check(
  'Anthropic 走 /v1/messages + x-api-key',
  sent?.url === 'https://api.anthropic.com/v1/messages' && sent?.headers?.['x-api-key'] === 'sk-ant',
  ''
);

// 3. 不支援的組合 → 400
res = await call({ provider: 'openai', model: 'whisper-1', key: 'k', words });
check('分段用了辨識模型 → 400 不支援', res._status === 400 && JSON.parse(res.body).error.includes('不支援'), res.body);

// 4. 缺 key → 400
res = await call({ provider: 'opencode-go', model: 'deepseek-v4-flash', key: '', words });
check('缺 key → 400', res._status === 400 && JSON.parse(res.body).error.includes('API Key'), res.body);

// 5. 供應商錯誤 → 502
globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'rate limited' } }) });
res = await call({ provider: 'opencode-go', model: 'deepseek-v4-flash', key: 'k', words });
check('供應商 429 → 502 含訊息', res._status === 502 && JSON.parse(res.body).error.includes('rate limited'), res.body);

console.log('\n=== RESULT ===');
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? 'ALL PASS' : `FAILED: ${failed.length}`, `(${results.length} checks)`);
process.exit(failed.length === 0 ? 0 : 1);