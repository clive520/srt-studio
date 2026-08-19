import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';

const FFMPEG_CORE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';

let ffmpegPromise = null;

async function getFFmpeg(onProgress) {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const ffmpeg = new FFmpeg();
      ffmpeg.on('progress', ({ progress }) => {
        if (typeof progress === 'number') onProgress?.(progress);
      });
      await ffmpeg.load({
        coreURL: await toBlobURL(`${FFMPEG_CORE}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${FFMPEG_CORE}/ffmpeg-core.wasm`, 'application/wasm'),
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
  const ffmpeg = await getFFmpeg(onProgress);
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
  const inName = `in.${ext}`;
  const outName = 'out.mp3';

  await ffmpeg.writeFile(inName, await fetchFile(file));
  const ret = await ffmpeg.exec([
    '-i', inName,
    '-vn', '-ac', '1', '-ar', '32000', '-b:a', '64k',
    '-loglevel', 'error', '-y', outName,
  ]);
  if (ret !== 0) throw new Error('音軌抽取失敗');

  const data = await ffmpeg.readFile(outName);
  await ffmpeg.deleteFile(inName);
  await ffmpeg.deleteFile(outName);
  return new Blob([data], { type: 'audio/mpeg' });
}