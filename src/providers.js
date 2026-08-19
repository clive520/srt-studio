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

export async function transcribe(provider, opts) {
  if (provider.form === 'openai') return transcribeOpenAI(provider, opts);
  if (provider.form === 'assemblyai') return transcribeAssemblyAI(provider, opts);
  throw new Error(`不支援的供應商：${provider.id}`);
}