import { buildSegmentsFromWords, cleanSegments, toSRT } from './src/srt.js';

// 模擬 Whisper 中文輸出：word 不含標點，靠停頓斷句
// 每句話之間約 0.6-0.8 秒停頓，逗號處約 0.3 秒
const zh = [
  { word: '今天', start: 0.00, end: 0.50 },
  { word: '天氣', start: 0.60, end: 1.00 },
  { word: '很好', start: 1.10, end: 1.60 },  // 停 0.7s → 句界
  { word: '我們', start: 2.30, end: 2.60 },
  { word: '一起', start: 2.70, end: 3.00 },
  { word: '去公園', start: 3.10, end: 3.60 }, // 停 0.6s → 句界
  { word: '然後', start: 4.20, end: 4.50 },
  { word: '回家', start: 4.60, end: 5.00 },  // 停 0.55s → 句界
  { word: '好好', start: 5.55, end: 5.90 },
  { word: '休息', start: 6.00, end: 6.40 },
];

// 模擬連續長句：無停頓但超過 42 字 → 強制切
const long = [];
for (let i = 0; i < 30; i++) {
  const t = i * 0.35;
  long.push({ word: '字', start: t, end: t + 0.3 });
}

// 模擬英文（字詞含前導空格）
const en = [
  { word: ' Hello', start: 0, end: 0.3 },
  { word: ' world,', start: 0.35, end: 0.7 },  // 逗號後 0.3s
  { word: ' this', start: 1.0, end: 1.3 },     // 停 0.3s → 逗號級
  { word: ' is', start: 1.35, end: 1.5 },
  { word: ' a', start: 1.6, end: 1.7 },
  { word: ' test', start: 1.8, end: 2.0 },     // 停 0.7s → 句界
  { word: ' Goodbye', start: 2.7, end: 3.1 },  // 停 0.7s → 句界
  { word: ' friends', start: 3.2, end: 3.5 },
];

function show(name, words) {
  const segs = buildSegmentsFromWords(words);
  console.log(`\n=== ${name} ===`);
  segs.forEach((s, i) => console.log(`${i + 1}  [${s.start.toFixed(2)} - ${s.end.toFixed(2)}] ${s.text}`));
  return segs;
}

const s1 = show('中文斷句（靠停頓）', zh);
const s2 = show('連續長句（強制切 42 字）', long);
const s3 = show('英文斷句（標點+停頓）', en);

console.log('\n=== SRT 輸出 ===');
console.log(toSRT([...s1, ...s2, ...s3]));

const ok1 = s1.length === 3 && s1[0].text === '今天天氣很好' && s1[1].text === '我們一起去公園' && s1[2].text === '然後回家好好休息';
const ok2 = s2.every((s) => [...s.text].length <= 42);
const ok3 = s3.length === 3 && s3[0].text === 'Hello world,' && s3[1].text === 'this is a test' && s3[2].text === 'Goodbye friends';
console.log('\n驗證:', { 中文斷句: ok1, 長句切分: ok2, 英文斷句: ok3 });

// 停留時間測試：字幕應在語音結束後多停留，且不超過下一段開始
const l = cleanSegments(s1);
const speechEnds = [1.6, 3.6, 6.4];
const nextStarts = [2.3, 4.2, Infinity];
const ok4 = l.every((s, i) => {
  const extended = s.end > speechEnds[i];          // 結束時間有延伸
  const notPast = s.end <= (nextStarts[i] === Infinity ? Infinity : nextStarts[i] - 0.15); // 不越過下一段
  return extended && notPast;
});
console.log('停留時間驗證:', l.map((s, i) => `${i + 1}[${s.start.toFixed(2)}-${s.end.toFixed(2)}] 語音止於 ${speechEnds[i]}s 延伸=${(s.end - speechEnds[i]).toFixed(2)}s`));
console.log('驗證4（停留時間）:', ok4);
process.exit(ok1 && ok2 && ok3 && ok4 ? 0 : 1);