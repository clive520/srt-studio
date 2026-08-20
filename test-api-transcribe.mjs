// 真實 api/transcribe.js handler 的本機測試：用瀏覽器同款 FormData 產生
// multipart body 打進去，驗證欄位解析、目錄驗證、轉送給供應商（fetch stub）、回傳格式。
import { Readable } from 'node:stream';
import handler from './api/transcribe.js';

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
};

const wav = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]); // 假 RIFF 檔頭

async function buildMultipart(fields, file = null) {
  // 與瀏覽器 fetch 完全相同的產生方式
  const fd = new FormData();
  for (const [name, value] of Object.entries(fields)) fd.append(name, value);
  if (file) fd.append('file', new Blob([file.data], { type: file.type }), file.filename);
  const req = new Request('http://localhost/', { method: 'POST', body: fd });
  const contentType = req.headers.get('content-type');
  return {
    buf: Buffer.from(await req.arrayBuffer()),
    boundary: contentType.match(/boundary=([^;]+)/)?.[1],
  };
}

function makeReq(buf, contentType) {
  const r = Readable.from([buf], { objectMode: false });
  r.method = 'POST';
  r.headers = { 'content-type': contentType };
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

function call(buf, contentType) {
  return new Promise((resolve, reject) => {
    const req = makeReq(buf, contentType);
    const res = makeRes();
    handler(req, res)
      .then(() => resolve(res))
      .catch(reject);
  });
}

// 1. 正常請求：groq + whisper + key + 中文檔名
let forwarded = null;
globalThis.fetch = async (url, opts) => {
  forwarded = { url, headers: opts.headers, body: opts.body };
  return {
    ok: true,
    json: async () => ({
      text: '第一句。',
      words: [{ word: '第一句', start: 0, end: 1.0 }],
      segments: [],
    }),
  };
};

const m1 = await buildMultipart(
  { provider: 'groq', model: 'whisper-large-v3-turbo', key: 'gsk-test', language: 'zh' },
  { filename: '我的錄音.mp3', type: 'audio/mpeg', data: wav }
);
let res = await call(m1.buf, `multipart/form-data; boundary=${m1.boundary}`);
check('正常請求回 200', res._status === 200, `status=${res._status} body=${res.body}`);
check('回傳含 words（逐字時間戳）', (() => {
  const d = JSON.parse(res.body);
  return d.words?.[0]?.start === 0 && d.words?.[0]?.word === '第一句';
})(), res.body);

check('轉送 URL = Groq transcriptions', forwarded?.url === 'https://api.groq.com/openai/v1/audio/transcriptions', forwarded?.url);
check('轉送帶 Bearer key', forwarded?.headers?.Authorization === 'Bearer gsk-test', '');
const fd = forwarded?.body;
check(
  '轉送的 FormData 含 model / language / verbose_json',
  fd instanceof FormData && fd.get('model') === 'whisper-large-v3-turbo' && fd.get('language') === 'zh' && fd.get('response_format') === 'verbose_json',
  ''
);

// 2. boundary 帶引號（部分 CDN/代理會這樣）→ 應正常解析
const m2 = await buildMultipart(
  { provider: 'groq', model: 'whisper-large-v3-turbo', key: 'k2', language: 'auto' },
  { filename: 'a.mp3', type: 'audio/mpeg', data: wav }
);
res = await call(m2.buf, `multipart/form-data; boundary="${m2.boundary}"`);
check('boundary 帶引號也能解析', res._status === 200, `status=${res._status} body=${res.body}`);

// 3. 缺少 file → 400 缺少音檔
const m3 = await buildMultipart({ provider: 'groq', model: 'whisper-large-v3-turbo', key: 'k3', language: 'auto' });
res = await call(m3.buf, `multipart/form-data; boundary=${m3.boundary}`);
check('缺 file → 400 缺少音檔', res._status === 400 && JSON.parse(res.body).error.includes('音檔'), res.body);

// 4. 不支援的模型 → 400 不支援
const m4 = await buildMultipart(
  { provider: 'groq', model: 'not-exist-model', key: 'k4', language: 'auto' },
  { filename: 'a.mp3', type: 'audio/mpeg', data: wav }
);
res = await call(m4.buf, `multipart/form-data; boundary=${m4.boundary}`);
check('模型不在目錄 → 400 不支援', res._status === 400 && JSON.parse(res.body).error.includes('不支援'), res.body);

// 5. 缺 key → 400 缺少 API Key
const m5 = await buildMultipart(
  { provider: 'groq', model: 'whisper-large-v3-turbo', key: '', language: 'auto' },
  { filename: 'a.mp3', type: 'audio/mpeg', data: wav }
);
res = await call(m5.buf, `multipart/form-data; boundary=${m5.boundary}`);
check('缺 key → 400 缺少 API Key', res._status === 400 && JSON.parse(res.body).error.includes('API Key'), res.body);

// 6. 非 multipart → 400
res = await call(Buffer.from('nope'), 'application/octet-stream');
check('非 multipart → 400', res._status === 400, `status=${res._status}`);

// 7. 供應商錯誤 → 502（含原始訊息）
globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid key' } }) });
const m7 = await buildMultipart(
  { provider: 'groq', model: 'whisper-large-v3-turbo', key: 'bad', language: 'auto' },
  { filename: 'a.mp3', type: 'audio/mpeg', data: wav }
);
res = await call(m7.buf, `multipart/form-data; boundary=${m7.boundary}`);
check('供應商 401 → 502 含訊息', res._status === 502 && JSON.parse(res.body).error.includes('invalid key'), res.body);

console.log('\n=== RESULT ===');
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? 'ALL PASS' : `FAILED: ${failed.length}`, `(${results.length} checks)`);
process.exit(failed.length === 0 ? 0 : 1);