import fs from 'node:fs';

const rate = 16000;
const seconds = 10;
const n = rate * seconds;
const samples = new Int16Array(n);
for (let i = 0; i < n; i++) {
  samples[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000);
}
const buf = Buffer.alloc(44 + samples.length * 2);
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + samples.length * 2, 4);
buf.write('WAVE', 8);
buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(rate, 24);
buf.writeUInt32LE(rate * 2, 28);
buf.writeUInt16LE(2, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36);
buf.writeUInt32LE(samples.length * 2, 40);
for (let i = 0; i < n; i++) buf.writeInt16LE(samples[i], 44 + i * 2);

const out = 'C:/opencode/srt-studio/test-fixtures/sine.wav';
fs.mkdirSync('C:/opencode/srt-studio/test-fixtures', { recursive: true });
fs.writeFileSync(out, buf);
console.log('OK', out, buf.length, 'bytes');
process.exit(0);