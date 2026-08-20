// 前端 API 客戶端：語音與分段請求走本站 /api/* 代理（繞過 CORS、統一格式），
// 但 Key 由使用者在瀏覽器填入、隨每個請求帶上，伺服器不儲存 Key。

async function errFrom(res) {
  let msg = `HTTP ${res.status}`;
  try {
    const e = await res.json();
    msg = e.error || e.message || JSON.stringify(e);
  } catch {
    /* ignore */
  }
  return new Error(msg);
}

export async function getCatalog() {
  const res = await fetch('/api/catalog');
  if (!res.ok) throw await errFrom(res);
  const data = await res.json();
  return data.catalog || null;
}

// stt: { provider, model, key }
export async function transcribe({ blob, filename, language, stt, onProgress }) {
  const fd = new FormData();
  fd.append('file', blob, filename || 'audio');
  fd.append('provider', stt.provider);
  fd.append('model', stt.model);
  fd.append('key', stt.key);
  fd.append('language', language || 'auto');
  const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
  if (!res.ok) throw await errFrom(res);
  const data = await res.json();
  onProgress?.({ status: 'done' });
  return {
    text: data.text || '',
    words: (data.words || []).map((w) => ({ start: w.start, end: w.end, word: w.word })),
    segments: (data.segments || []).map((s) => ({ start: s.start, end: s.end, text: s.text })),
  };
}

// seg: { provider, model, key }
export async function segment({ words, seg }) {
  const res = await fetch('/api/segment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ words, provider: seg.provider, model: seg.model, key: seg.key }),
  });
  if (!res.ok) throw await errFrom(res);
  const data = await res.json();
  if (!Array.isArray(data.boundaries)) throw new Error('伺服器回傳格式錯誤');
  return data.boundaries;
}