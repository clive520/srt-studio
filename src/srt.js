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

const SENTENCE_END = /[。！？!?；;…]$/;
const CLAUSE_END = /[，,、：:]$/;

/**
 * 依人類說話節奏斷句：以「字詞之間的靜音間隔」為主要訊號（Whisper 的 word 時間戳不含標點，
 * 所以靠語速與停頓判斷斷句位置），並用標點與最大字數補強。
 *
 * 規則（由強到弱）：
 *  1. 字詞結尾是句末標點（。！？…；;）→ 斷
 *  2. 下一詞前靜音 > hardPause 秒 → 斷（長停頓，句界）
 *  3. 已累積 minChars 字且靜音 > softPause 秒 → 斷（短停頓，逗號級）
 *  4. 超過 maxChars 字 → 強制切（防過長）
 *  5. 剩餘太短的片段併入前一段，避免閃爍
 */
export function buildSegmentsFromWords(
  words,
  { maxChars = 42, hardPause = 0.55, softPause = 0.28, minChars = 12 } = {}
) {
  const tokens = words.filter((w) => w.word && w.word.trim());
  if (!tokens.length) return [];

  const segs = [];
  let buf = [];
  let bufStart = null;

  const flush = () => {
    if (!buf.length) return;
    const text = buf.map((w) => w.word).join('').replace(/\s+/g, ' ').trim();
    if (text) segs.push({ start: buf[0].start, end: buf[buf.length - 1].end, text });
    buf = [];
    bufStart = null;
  };

  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i];
    if (bufStart === null) bufStart = w.start;
    buf.push(w);

    const lastChar = [...w.word.trim()].pop() || '';
    const next = tokens[i + 1];
    const gap = next ? next.start - w.end : 0;
    const charCount = buf.map((x) => x.word).join('').replace(/\s/g, '').length;

    const punctBreak = SENTENCE_END.test(lastChar) || (CLAUSE_END.test(lastChar) && charCount >= 4);
    const hardBreak = next !== undefined && gap > hardPause;
    const softBreak = !hardBreak && charCount >= minChars && gap > softPause;
    const maxBreak = charCount >= maxChars;

    if (punctBreak || hardBreak || softBreak || maxBreak) flush();
  }
  flush();

  // 只把極短（<0.45s）的碎屑併入前一段，避免閃爍，但保留合理短句
  const out = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    if (prev && s.end - s.start < 0.45 && prev.end - prev.start < 8) {
      prev.text = `${prev.text} ${s.text}`.trim();
      prev.end = s.end;
    } else {
      out.push(s);
    }
  }
  return out;
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