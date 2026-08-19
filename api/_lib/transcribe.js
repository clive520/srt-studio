// 語音辨識核心邏輯（伺服器端）：轉送給 STT 供應商，回傳統一格式
// { text, words: [{word,start,end}], segments: [{start,end,text}] }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function parseSRT(text) {
  const segs = [];
  const blocks = String(text || '').split(/\r?\n\r?\n/);
  for (const b of blocks) {
    const lines = b.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 3) continue;
    const m = lines[1].match(/([\d:.]+)\s*-->\s*([\d:.]+)/);
    if (!m) continue;
    const toSec = (s) => {
      const p = s.split(':').map(Number);
      return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
    };
    segs.push({ start: toSec(m[1]), end: toSec(m[2]), text: lines.slice(2).join(' ').trim() });
  }
  return segs;
}

async function transcribeOpenAI(provider, { rawBody, contentType, filename, language }) {
  const fd = new FormData();
  fd.append('file', new Blob([rawBody], { type: contentType || 'application/octet-stream' }), filename || 'audio');
  fd.append('model', provider.model);
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'word');
  if (language && language !== 'auto') fd.append('language', language);

  const res = await fetch(`${provider.baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.key}` },
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

async function transcribeAssemblyAI(provider, { rawBody, contentType, filename, language, onProgress }) {
  const base = provider.baseUrl;
  const up = await fetch(`${base}/v2/upload`, {
    method: 'POST',
    headers: { Authorization: provider.key, 'Content-Type': 'application/octet-stream' },
    body: Buffer.from(rawBody),
  });
  if (!up.ok) throw await errFrom(up);
  const { upload_url } = await up.json();

  const body = { audio_url: upload_url, punctuate: true, format_text: true };
  if (language && language !== 'auto') body.language_code = language;

  const tr = await fetch(`${base}/v2/transcript`, {
    method: 'POST',
    headers: { Authorization: provider.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!tr.ok) throw await errFrom(tr);
  const { id } = await tr.json();

  for (let i = 0; i < 25; i++) {
    await sleep(2000);
    const st = await fetch(`${base}/v2/transcript/${id}`, {
      headers: { Authorization: provider.key },
    });
    if (!st.ok) throw await errFrom(st);
    const d = await st.json();
    onProgress?.({ status: d.status, detail: d.error });
    if (d.status === 'completed') {
      const srtRes = await fetch(`${base}/v2/transcript/${id}/srt`, {
        headers: { Authorization: provider.key },
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
  if (provider.kind === 'openai') return transcribeOpenAI(provider, opts);
  if (provider.kind === 'assemblyai') return transcribeAssemblyAI(provider, opts);
  throw new Error(`不支援的辨識供應商：${provider.id || provider.kind}`);
}