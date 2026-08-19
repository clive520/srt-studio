// 前端 API 客戶端：全部走本站 /api/* 代理，Key 只在伺服器端

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

export async function getStatus() {
  const res = await fetch('/api/status');
  if (!res.ok) throw await errFrom(res);
  return res.json();
}

export async function transcribe({ blob, filename, language, onProgress }) {
  const fd = new FormData();
  fd.append('file', blob, filename || 'audio');
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

export async function segment({ words }) {
  const res = await fetch('/api/segment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ words }),
  });
  if (!res.ok) throw await errFrom(res);
  const data = await res.json();
  if (!Array.isArray(data.boundaries)) throw new Error('伺服器回傳格式錯誤');
  return data.boundaries;
}

export async function adminGet(password) {
  const res = await fetch('/api/admin', {
    headers: { 'x-admin-password': password },
  });
  if (!res.ok) throw await errFrom(res);
  return res.json();
}

export async function adminPut(password, body) {
  const res = await fetch('/api/admin', {
    method: 'PUT',
    headers: { 'x-admin-password': password, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await errFrom(res);
  return res.json();
}