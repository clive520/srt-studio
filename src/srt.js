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

export function cleanSegments(segs, opts) {
  const sorted = segs
    .filter((x) => x.text && x.text.trim() && x.end > x.start)
    .map((x) => ({
      start: Math.max(0, x.start),
      end: Math.max(0, x.end),
      text: x.text.trim(),
      words: x.words,
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const out = [];
  let prevEnd = 0;
  for (const x of sorted) {
    const start = Math.max(x.start, prevEnd);
    const end = Math.max(x.end, start + 0.3);
    prevEnd = end;
    out.push({ start, end, text: x.text, words: x.words });
  }
  return applyLinger(out, opts);
}

/**
 * 讓字幕在語音結束後再多停留一段時間再消失，避免「突然不見」。
 * - 語音結束後延伸 linger 秒（預設 0.8s），讓字幕有時間被看完
 * - 至少顯示 minDisplay 秒，短片段不會一閃而過
 * - 但不會越過下一段的開始（保留 gap 秒），字幕會在下一句出現前才消失
 */
export function applyLinger(segs, { linger = 0.8, minDisplay = 1.3, gap = 0.15 } = {}) {
  return segs.map((s, i) => {
    const next = segs[i + 1];
    const cap = next ? Math.max(next.start - gap, s.end) : Infinity;
    const end = Math.min(Math.max(s.end + linger, s.start + minDisplay), cap);
    return { ...s, end };
  });
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
    if (text)
      segs.push({
        start: buf[0].start,
        end: buf[buf.length - 1].end,
        text,
        words: buf.map((w) => ({ word: w.word, start: w.start, end: w.end })),
      });
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
      prev.words = [...(prev.words || []), ...(s.words || [])];
    } else {
      out.push(s);
    }
  }
  return out;
}

/** 把字詞陣列還原成與段落一致的文字（與 buildSegmentsFromWords 相同規則） */
export function wordsToText(words) {
  return (words || []).map((w) => w.word).join('').replace(/\s+/g, ' ').trim();
}

/**
 * 依 AI 給的段界重建字幕段。boundaries 是「每一段最後一個字詞的索引」（1-based），
 * 過濾掉無效值後依序切片，段時間直接採用該段首/尾字的真實時間。
 */
export function buildSegmentsFromRanges(words, boundaries) {
  const tokens = words.filter((w) => w.word && w.word.trim());
  if (!tokens.length) return [];
  const bs = [...new Set((boundaries || []).map((b) => Math.round(b)))].filter(
    (b) => Number.isFinite(b) && b >= 1 && b <= tokens.length
  ).sort((a, b) => a - b);
  const segs = [];
  const push = (buf) => {
    if (!buf.length) return;
    const text = buf.map((w) => w.word).join('').replace(/\s+/g, ' ').trim();
    if (text)
      segs.push({
        start: buf[0].start,
        end: buf[buf.length - 1].end,
        text,
        words: buf.map((w) => ({ word: w.word, start: w.start, end: w.end })),
      });
  };
  let prev = 0;
  for (const b of bs) {
    push(tokens.slice(prev, b));
    prev = b;
  }
  push(tokens.slice(prev));
  return segs;
}

/**
 * 依游標字元位置切分字詞陣列：
 * - caret 正好在某個字後面 → 切成左右兩半，切點時間 = 下一字開始的真實時間
 * - caret 落在某個字中間（如英文單字）→ 右半從該字開始，切點 = 該字開始時間
 * 回傳 null 代表無法對應（文字與字詞對不上）。
 */
export function splitWordsAt(words, caret) {
  if (!words || !words.length) return null;
  let acc = '';
  for (let i = 0; i < words.length; i++) {
    const next = `${acc}${words[i].word}`.replace(/\s+/g, ' ').trim();
    if (caret < next.length) return { left: words.slice(0, i), right: words.slice(i), boundary: words[i].start };
    if (caret === next.length) {
      const k = i + 1;
      return { left: words.slice(0, k), right: words.slice(k), boundary: (words[k] || words[i]).start };
    }
    acc = next;
  }
  return { left: words, right: [], boundary: null };
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