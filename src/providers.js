import { parseSRT } from './srt.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const PROVIDERS = [
  {
    id: 'groq',
    name: 'Groq（Whisper・免費額度）',
    form: 'openai',
    url: 'https://api.groq.com/openai/v1/audio/transcriptions',
    model: 'whisper-large-v3-turbo',
    keyUrl: 'https://console.groq.com/keys',
    note: '免費額度大、速度快，建議作為預設',
  },
  {
    id: 'openai',
    name: 'OpenAI Whisper',
    form: 'openai',
    url: 'https://api.openai.com/v1/audio/transcriptions',
    model: 'whisper-1',
    keyUrl: 'https://platform.openai.com/api-keys',
    note: '每分鐘約 $0.006，支援逐字時間戳',
  },
  {
    id: 'assemblyai',
    name: 'AssemblyAI',
    form: 'assemblyai',
    url: 'https://api.assemblyai.com',
    keyUrl: 'https://www.assemblyai.com/app/account/api-keys',
    note: '有免費額度，官方直接輸出 SRT',
  },
];

export const LANGUAGES = [
  { value: 'auto', label: '自動偵測' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
];

async function errFrom(res) {
  let msg = `HTTP ${res.status}`;
  try {
    const e = await res.json();
    msg = e.error?.message || e.error || e.message || JSON.stringify(e);
  } catch {
    /* ignore */
  }
  return new Error(msg);
}

async function transcribeOpenAI(provider, { blob, filename, key, language }) {
  const fd = new FormData();
  fd.append('file', blob, filename);
  fd.append('model', provider.model);
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'word');
  if (language && language !== 'auto') fd.append('language', language);

  const res = await fetch(provider.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: fd,
  });
  if (!res.ok) throw await errFrom(res);
  const data = await res.json();
  return {
    text: data.text || '',
    words: (data.words || []).map((w) => ({ start: w.start, end: w.end, word: w.word })),
    segments: (data.segments || []).map((s) => ({ start: s.start, end: s.end, text: s.text })),
  };
}

async function transcribeAssemblyAI(provider, { blob, key, language, onProgress }) {
  const base = provider.url;

  const up = await fetch(`${base}/v2/upload`, {
    method: 'POST',
    headers: { Authorization: key, 'Content-Type': 'application/octet-stream' },
    body: blob,
  });
  if (!up.ok) throw await errFrom(up);
  const { upload_url } = await up.json();

  const body = { audio_url: upload_url, punctuate: true, format_text: true };
  if (language && language !== 'auto') body.language_code = language;

  const tr = await fetch(`${base}/v2/transcript`, {
    method: 'POST',
    headers: { Authorization: key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!tr.ok) throw await errFrom(tr);
  const { id } = await tr.json();

  for (let i = 0; i < 150; i++) {
    await sleep(2000);
    const st = await fetch(`${base}/v2/transcript/${id}`, {
      headers: { Authorization: key },
    });
    if (!st.ok) throw await errFrom(st);
    const d = await st.json();
    onProgress?.({ status: d.status, detail: d.error });
    if (d.status === 'completed') {
      const srtRes = await fetch(`${base}/v2/transcript/${id}/srt`, {
        headers: { Authorization: key },
      });
      if (!srtRes.ok) throw await errFrom(srtRes);
      return {
        text: d.text || '',
        words: [],
        segments: parseSRT(await srtRes.text()),
      };
    }
    if (d.status === 'error') throw new Error(d.error || '辨識失敗');
  }
  throw new Error('等待逾時，請稍後再試');
}

const SEG_CHAT = {
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', model: 'groq/compound-mini' },
  openai: { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
};

function segPrompt(tokens) {
  const list = tokens.map((w, i) => `${i + 1}. ${w.word} [${w.start.toFixed(1)}-${w.end.toFixed(1)}]`).join('\n');
  return (
    '你是字幕分段專家。以下是語音辨識出的逐字稿，每個字詞附上編號與時間（秒）。' +
    '請把字詞分成適合字幕顯示的段落：以句意為界（句號、問號、驚嘆號結尾優先），' +
    '長句可在逗號或停頓處切開，每段以 8~25 個字為宜，段落內的語意要連貫，不要合併不相干內容。\n\n' +
    `${list}\n\n` +
    '請只回傳 JSON（不要任何其他文字）：{"boundaries":[數字,...]}，' +
    '數字代表每一段「最後一個字詞的編號」（最後一段不需要列）。'
  );
}

function parseBoundaries(raw) {
  const m = String(raw || '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI 回傳的格式無法解析');
  let obj;
  try {
    obj = JSON.parse(m[0]);
  } catch (e) {
    throw new Error(`AI 回傳的 JSON 無法解析：${e.message}`);
  }
  const b = obj?.boundaries;
  if (!Array.isArray(b)) throw new Error('AI 回傳缺少 boundaries 欄位');
  return b.filter((x) => Number.isFinite(+x)).map((x) => Math.round(+x));
}

/**
 * 第二次 AI 辨識：把逐字稿（含逐字時間）交給 AI 決定分段點，
 * 回傳每一段的結束字詞編號。回傳 Promise<number[]>。
 */
export async function segmentByAI(provider, { key, words }) {
  const tokens = (words || []).filter((w) => w.word && w.word.trim());
  if (tokens.length < 3) throw new Error('字詞數量不足（至少 3 個字），無法 AI 分段');

  if (provider.form === 'assemblyai') {
    const res = await fetch(`${provider.url}/v2/lemur/task`, {
      method: 'POST',
      headers: { Authorization: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: segPrompt(tokens),
        input_text: '（見 prompt 內的逐字稿）',
        temperature: 0,
        max_output_size: 1000,
      }),
    });
    if (!res.ok) throw await errFrom(res);
    const data = await res.json();
    return parseBoundaries(data.response ?? '');
  }

  const cfg = SEG_CHAT[provider.id];
  if (!cfg) throw new Error(`不支援 ${provider.name} 的 AI 分段`);
  // 分批送：單一請求若包含整份逐字稿，長音檔會超過模型的
  // 輸入上限 / TPM 額度（413）。每批 ~1000 字詞（約 6K tokens）。
  const CHUNK_WORDS = 1000;
  const boundaries = [];
  for (let i = 0; i < tokens.length; i += CHUNK_WORDS) {
    const part = tokens.slice(i, i + CHUNK_WORDS);
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: segPrompt(part) }],
        temperature: 0,
      }),
    });
    if (!res.ok) throw await errFrom(res);
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content ?? '';
    const seen = new Set(boundaries);
    for (const b of parseBoundaries(raw)) {
      const g = i + b; // 批次內是 1-based 編號，換算回全域
      if (g > 0 && g <= tokens.length && !seen.has(g)) {
        seen.add(g);
        boundaries.push(g);
      }
    }
  }
  if (!boundaries.length) throw new Error('AI 回傳的段界無法使用');
  return boundaries;
}

export async function transcribe(provider, opts) {
  if (provider.form === 'openai') return transcribeOpenAI(provider, opts);
  if (provider.form === 'assemblyai') return transcribeAssemblyAI(provider, opts);
  throw new Error(`不支援的供應商：${provider.id}`);
}