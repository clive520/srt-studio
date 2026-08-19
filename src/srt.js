const ENDERS = new Set(['。', '！', '？', '!', '?', '…', '⋯', '.', '；', ';']);

export function fmtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mi = ms % 1000;
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(mi, 3)}`;
}

export function parseTime(str) {
  const s = String(str).trim().replace(',', '.');
  let m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);
  if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3];
  m = /(\d+):(\d+(?:\.\d+)?)/.exec(s);
  if (m) return +m[1] * 60 + +m[2];
  return parseFloat(s) || 0;
}

export function parseSRT(text) {
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/);
  const segs = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    if (lines.length < 2) continue;
    let timeIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) { timeIdx = i; break; }
    }
    if (timeIdx < 0) continue;
    const m = /([\d:,.]{4,})\s*-->\s*([\d:,.]{4,})/.exec(lines[timeIdx]);
    if (!m) continue;
    const text = lines.slice(timeIdx + 1).join('\n').trim();
    if (!text) continue;
    segs.push({ start: parseTime(m[1]), end: parseTime(m[2]), text });
  }
  return segs;
}

export function toSRT(segs) {
  return segs
    .map((s, i) => `${i + 1}\n${fmtTime(s.start)} --> ${fmtTime(s.end)}\n${s.text.trim()}\n`)
    .join('\n');
}

export function cleanSegments(segs) {
  const sorted = segs
    .filter((x) => x.text && x.text.trim() && x.end > x.start)
    .map((x) => ({
      start: Math.max(0, x.start),
      end: Math.max(0, x.end),
      text: x.text.trim(),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const out = [];
  let prevEnd = 0;
  for (const x of sorted) {
    const start = Math.max(x.start, prevEnd);
    const end = Math.max(x.end, start + 0.3);
    prevEnd = end;
    out.push({ start, end, text: x.text });
  }
  return out;
}

export function buildSegmentsFromWords(words, { maxChars = 42 } = {}) {
  const tokens = words.filter((w) => w.word && w.word.trim());
  const segs = [];
  let buf = [];
  let bufStart = null;

  const flush = () => {
    if (!buf.length) return;
    const joined = buf.map((w) => w.word).join('').replace(/\s+/g, ' ').trim();
    if (joined) {
      segs.push({ start: buf[0].start, end: buf[buf.length - 1].end, text: joined });
    }
    buf = [];
    bufStart = null;
  };

  for (const w of tokens) {
    if (bufStart === null) bufStart = w.start;
    buf.push(w);
    const lastChar = [...w.word.trim()].pop() || '';
    const charCount = buf.map((x) => x.word).join('').replace(/\s/g, '').length;
    if ((ENDERS.has(lastChar) && charCount >= 2) || charCount >= maxChars) flush();
  }
  flush();
  return segs;
}

export function downloadSRT(segs) {
  const blob = new Blob([toSRT(segs)], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'subtitles.srt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}