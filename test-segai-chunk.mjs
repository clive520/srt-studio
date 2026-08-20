import { segmentByAI } from './api/_lib/segment.js';

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
};

// 2500 個字詞 → 3 批（1000/1000/500）。每批回傳批次內的段界，
// 驗證批次編號換算回全域 + 批次數 + 每批 prompt 內容。
const words = [];
for (let i = 0; i < 2500; i++) words.push({ word: '字', start: i * 0.4, end: i * 0.4 + 0.3 });

const PROV = { kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'groq/compound-mini', key: 'k' };

const calls = [];
const prompts = [];
const responses = ['{"boundaries":[500]}', '{"boundaries":[700]}', '{"boundaries":[300]}', '{"boundaries":[50]}'];
// 批次併發送出，改依「prompt 內容」判斷是哪一批，避免依呼叫順序誤配回應
globalThis.fetch = async (url, opts) => {
  calls.push(url);
  const content = JSON.parse(opts.body).messages[0].content;
  // 用每批「最後一個字詞」的獨特時間戳判斷是哪一批
  let which;
  if (content.includes('999.6-999.9')) which = 2; // 批次3 結尾 500. 字
  else if (content.includes('799.6-799.9')) which = 1; // 批次2 結尾 1000. 字
  else if (content.includes('399.6-399.9')) which = 0; // 批次1 結尾 1000. 字
  else which = 3; // 短音檔（單批 50 字）
  prompts[which] = content;
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: responses[which] } }],
    }),
  };
};

const boundaries = await segmentByAI(PROV, { words });

check('分批：共 3 次請求', calls.length === 3, `calls=${calls.length}`);
check('每批都送 chat/completions', calls.every((u) => u.includes('chat/completions')), '');
check(
  '批次 1：只含字詞 1~1000（區域編號）',
  prompts[0].includes('1. 字 [0.0-0.3]') && prompts[0].includes('1000. 字 [399.6-399.9]') && !prompts[0].includes('1001'),
  ''
);
check(
  '批次 2：從區域編號 1 重新開始',
  prompts[1].includes('1. 字 [400.0-400.3]') && prompts[1].includes('1000. 字 [799.6-799.9]'),
  ''
);
check(
  '批次 3：只含字詞 2001~2500',
  prompts[2].includes('1. 字 [800.0-800.3]') && prompts[2].includes('500. 字 [999.6-999.9]') && !prompts[2].includes('501'),
  ''
);
check('段界換算回全域：[500, 1700, 2300]', JSON.stringify(boundaries) === '[500,1700,2300]', `got=${JSON.stringify(boundaries)}`);
check('段界已排序', boundaries.every((b, i) => i === 0 || boundaries[i - 1] < b), '');

// 單批（短音檔）行為不變
const short = await segmentByAI(PROV, { words: words.slice(0, 50) });
check('短音檔只送 1 批', calls.length === 4, `calls=${calls.length}`);
check('短音檔段界正常', JSON.stringify(short) === '[50]', `got=${JSON.stringify(short)}`);

// 所有批次都失敗 → 拋錯（App 端會保留啟發式結果）
globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '抱歉，無法處理' } }] }) });
let threw = false;
try {
  await segmentByAI(PROV, { words });
} catch (e) {
  threw = true;
  check('全部批次無效 → 拋錯', /段界|解析/.test(e.message), e.message);
}
check('全部批次無效確實拋錯', threw, '');

// Anthropic 格式：x-api-key + anthropic-version + system 欄位
let anBody = null;
let anHeaders = null;
globalThis.fetch = async (url, opts) => {
  anHeaders = opts.headers;
  anBody = JSON.parse(opts.body);
  return {
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: '{"boundaries":[2]}' }] }),
  };
};
const an = await segmentByAI(
  { kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-6', key: 'sk-an' },
  { words: words.slice(0, 50) }
);
check(
  'Anthropic：送 /v1/messages + x-api-key + anthropic-version',
  anHeaders['x-api-key'] === 'sk-an' && anHeaders['anthropic-version'] === '2023-06-01',
  ''
);
check('Anthropic：body 含 system 與 max_tokens', anBody.system && anBody.max_tokens === 2000 && anBody.messages[0].role === 'user', '');
check('Anthropic：從 content[0].text 取段界', JSON.stringify(an) === '[2]', `got=${JSON.stringify(an)}`);

console.log('\n=== RESULT ===');
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? 'ALL PASS' : `FAILED: ${failed.length}`, `(${results.length} checks)`);
process.exit(failed.length === 0 ? 0 : 1);