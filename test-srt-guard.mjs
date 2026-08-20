// splitLongSegments（超過 maxDur 的段在最大字詞間隙處遞迴切開）＋新版分段提示內容
import { splitLongSegments, buildSegmentsFromRanges } from './src/srt.js';
import { segPrompt } from './api/_lib/segment.js';

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
};

// 一段 8 秒、含兩個明顯停頓（0.9s、0.2s）的逐字稿
const words = [];
let t = 0;
const parts = [
  { n: 8, gapAfter: 0.9 }, // 0-2s
  { n: 6, gapAfter: 0.2 }, // 2.9-4.4s
  { n: 8, gapAfter: 0 },   // 4.6-6.6s
];
for (const p of parts) {
  for (let i = 0; i < p.n; i++) {
    const w = { word: '字', start: t, end: t + 0.25 };
    words.push(w);
    t = w.end;
  }
  t += p.gapAfter;
}

// 1. 最大間隙切在 2.0s（0.9s 停頓）→ 兩半都 <= 5s
let segs = buildSegmentsFromRanges(words, [words.length]); // 整段當一段
check('原始一段 6.6 秒（>5s）', segs.length === 1 && Math.round(segs[0].end - segs[0].start) === 7, '');
const out = splitLongSegments(segs);
check('8 秒段被切開', out.length > 1, `segments=${out.length}`);
check('切點在最大停頓處（2.0s）', out[0].end === 2.0, `end=${out[0].end}`);
check('切完每段都不超過 5 秒', out.every((s) => s.end - s.start <= 5), out.map((s) => + (s.end - s.start).toFixed(1)).join(','));
check('文字接起來與原文相同', out.map((s) => s.text).join('') === segs[0].text, '');

// 2. 界線 [4,20] 的段跨到 0.9s 大停頓（1.0~6.1 = 5.1s > 5s）→ 在大停頓處切，其餘短段不動
segs = buildSegmentsFromRanges(words, [4, 20]);
const out2 = splitLongSegments(segs);
check(
  '5.1 秒段在大停頓處切開',
  out2.length === 4 && out2[1].end === 2.0 && out2[2].start === 2.9 && out2.every((s) => s.end - s.start <= 5),
  out2.map((s) => +(s.end - s.start).toFixed(1)).join(',')
);

// 3. 沒有 words 的段（如直接匯入 SRT）不誤切
const noWords = [{ start: 0, end: 9, text: '很長的段落但沒有字詞資料' }];
check('無字詞資料原樣保留', splitLongSegments(noWords).length === 1, '');

// 4. 極端：整段 20 秒、停頓很小 → 遞迴切到 <=5 秒
const big = [];
for (let i = 0; i < 40; i++) {
  big.push({ word: '字', start: i * 0.51, end: i * 0.51 + 0.5 });
}
const bigSeg = [{ start: 0, end: 20.3, text: '字'.repeat(40), words: big }];
const outBig = splitLongSegments(bigSeg);
check('20 秒段遞迴切到每段 <=5 秒', outBig.every((s) => s.end - s.start <= 5) && outBig.length >= 4, `segments=${outBig.length}`);

// 5. 新版提示內容：時間長度規則與禁止切斷名詞短語
const p = segPrompt([{ word: '你', start: 0.1, end: 0.3 }]);
check('提示限定每段 8~18 字', p.includes('8~18'), '');
check('提示要求每段 1.5~4 秒', p.includes('1.5~4 秒'), '');
check('提示處理無標點逐字稿', p.includes('若沒有標點'), '');
check('提示禁止切斷名詞短語', p.includes('名詞短語'), '');

console.log('\n=== RESULT ===');
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? 'ALL PASS' : `FAILED: ${failed.length}`, `(${results.length} checks)`);
process.exit(failed.length === 0 ? 0 : 1);