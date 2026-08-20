import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

const FFMPEG_CORE = 'https://unpkg.com/@ffmpeg/core@0.12.9/dist/esm';

let ffmpegPromise = null;
let ffmpegLogs = [];

function attachLogs(ffmpeg) {
  ffmpeg.on('log', ({ type, message }) => {
    if (type === 'stderr') ffmpegLogs.push(message);
  });
}

async function getFFmpeg(onProgress) {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const ffmpeg = new FFmpeg();
      ffmpeg.on('progress', ({ progress }) => {
        if (typeof progress === 'number') onProgress?.(progress);
      });
      attachLogs(ffmpeg);
      await ffmpeg.load({
        coreURL: `${FFMPEG_CORE}/ffmpeg-core.js`,
        wasmURL: `${FFMPEG_CORE}/ffmpeg-core.wasm`,
      });
      return ffmpeg;
    })();
  }
  return ffmpegPromise;
}

export function isVideoFile(file) {
  return /video\//.test(file.type) || /\.(mp4|mov|mkv|avi|webm|m4v|flv|ts|mts)$/i.test(file.name);
}

export async function extractAudio(file, onProgress) {
  ffmpegLogs = [];
  const ffmpeg = await getFFmpeg(onProgress);
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
  const inName = `in.${ext}`;
  const outName = 'out.mp3';

  await ffmpeg.writeFile(inName, await fetchFile(file));
  let ret;
  try {
    ret = await ffmpeg.exec([
      '-i', inName,
      '-vn', '-ac', '1', '-ar', '32000', '-b:a', '64k',
      '-y', outName,
    ]);
  } catch (e) {
    const detail = ffmpegLogs.join('\n').trim();
    const msg = detail || e?.message || String(e || '');
    throw new Error(`音軌抽取失敗${msg ? `：${msg}` : ''}`);
  }
  if (ret !== 0) {
    const detail = ffmpegLogs.join('\n').trim();
    throw new Error(`音軌抽取失敗${detail ? `：${detail}` : ''}`);
  }

  const data = await ffmpeg.readFile(outName);
  await ffmpeg.deleteFile(inName).catch(() => {});
  await ffmpeg.deleteFile(outName).catch(() => {});
  return new Blob([data], { type: 'audio/mpeg' });
}

/**
 * 上傳前壓縮：伺服器端點（Vercel Hobby）請求上限約 4.5MB。
 * 超過就轉成 16kHz 單聲道 48kbps mp3（約 6KB/s，10 分鐘 ≈ 3.6MB）。
 * 壓縮後仍超過 3.8MB 就切成多塊 mp3（chunks），逐塊上傳辨識再合併。
 * 回傳 { blob, filename, compressed, chunks }：
 *   chunks = null → 單塊直接上傳；
 *   chunks = [{ blob, filename, offset }] → 依序上傳，offset 是該塊的起始秒數。
 */
export async function prepareUpload(
  blob,
  filename,
  onProgress,
  { compressThreshold = 4.2 * 1024 * 1024, chunkMaxBytes = 3.6 * 1024 * 1024 } = {}
) {
  if (blob.size <= compressThreshold) {
    return { blob, filename, compressed: false, chunks: null };
  }
  const ffmpeg = await getFFmpeg(onProgress);
  const ext = (filename?.split('.').pop() || 'mp3').toLowerCase();
  const inName = `in.${ext}`;
  const outName = 'out.mp3';
  await ffmpeg.writeFile(inName, await fetchFile(blob));
  let ret;
  try {
    ret = await ffmpeg.exec([
      '-i', inName,
      '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k',
      '-y', outName,
    ]);
  } catch (e) {
    const detail = ffmpegLogs.join('\n').trim();
    throw new Error(`音檔壓縮失敗${detail ? `：${detail}` : ''}`);
  }
  if (ret !== 0) {
    const detail = ffmpegLogs.join('\n').trim();
    throw new Error(`音檔壓縮失敗${detail ? `：${detail}` : ''}`);
  }
  const data = await ffmpeg.readFile(outName);
  await ffmpeg.deleteFile(inName).catch(() => {});
  await ffmpeg.deleteFile(outName).catch(() => {});
  const outBlob = new Blob([data], { type: 'audio/mpeg' });
  if (outBlob.size <= chunkMaxBytes) {
    return { blob: outBlob, filename: 'compressed.mp3', compressed: true, chunks: null };
  }
  const chunks = await splitMp3Chunks(outBlob, chunkMaxBytes);
  return { blob: outBlob, filename: 'compressed.mp3', compressed: true, chunks };
}

/**
 * 把 mp3 切成多塊（-c copy 不重新編碼，靠 segment muxer 在影格邊界切）。
 * 48kbps ≈ 6KB/s，每塊抓 3.6MB 以下（約 9~10 分鐘），離 Vercel 4.5MB 上限留餘裕。
 */
async function splitMp3Chunks(blob, maxBytes) {
  const bytesPerSec = 48000 / 8;
  const segSec = Math.max(1, Math.floor(maxBytes / bytesPerSec));
  const ffmpeg = await getFFmpeg();
  const inName = 'in.mp3';
  await ffmpeg.writeFile(inName, await fetchFile(blob));
  let ret;
  try {
    ret = await ffmpeg.exec([
      '-i', inName,
      '-f', 'segment',
      '-segment_time', String(segSec),
      '-reset_timestamps', '1',
      '-c', 'copy',
      'chunk_%03d.mp3',
    ]);
  } catch (e) {
    const detail = ffmpegLogs.join('\n').trim();
    throw new Error(`音檔分段失敗${detail ? `：${detail}` : ''}`);
  }
  if (ret !== 0) {
    const detail = ffmpegLogs.join('\n').trim();
    throw new Error(`音檔分段失敗${detail ? `：${detail}` : ''}`);
  }
  const chunks = [];
  for (let i = 0; ; i++) {
    const n = `chunk_${String(i).padStart(3, '0')}.mp3`;
    let data;
    try {
      data = await ffmpeg.readFile(n);
    } catch {
      break;
    }
    chunks.push({
      blob: new Blob([data], { type: 'audio/mpeg' }),
      filename: n,
      offset: i * segSec,
    });
    await ffmpeg.deleteFile(n).catch(() => {});
  }
  await ffmpeg.deleteFile(inName).catch(() => {});
  if (!chunks.length) throw new Error('音檔分段失敗：找不到分段結果');
  return chunks;
}