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