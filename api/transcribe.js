import { findProvider } from './_lib/catalog.js';
import { transcribe } from './_lib/transcribe.js';
import { json } from './_lib/util.js';

export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method Not Allowed' });

  const contentType = req.headers['content-type'] || '';
  const boundary = contentType.match(/boundary=([^;]+)/)?.[1] || '';
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 5 * 1024 * 1024) return json(res, 413, { error: '檔案太大（上限約 4.5MB），請使用較短的音檔或降低音質' });
    chunks.push(c);
  }
  const buf = Buffer.concat(chunks);
  if (!boundary) return json(res, 400, { error: '請以 multipart/form-data 上傳' });

  // 手動解析 multipart：取出 file 與 provider/model/key/language 欄位
  const fields = {};
  let fileBuf = null;
  let fileType = 'application/octet-stream';
  let filename = 'audio';
  const parts = splitMultipart(buf, boundary);
  for (const part of parts) {
    const name = part.headers.match(/name="([^"]+)"/)?.[1];
    if (name === 'file') {
      fileBuf = part.body;
      fileType = part.headers.match(/content-type: ?([^\r\n]+)/i)?.[1] || 'application/octet-stream';
      filename = part.headers.match(/filename="([^"]+)"/)?.[1] || 'audio';
    } else if (name) {
      fields[name] = part.body.toString('utf8').trim();
    }
  }
  if (!fileBuf || !fileBuf.length) return json(res, 400, { error: '缺少音檔（file）' });

  const provider = findProvider('stt', fields.provider);
  if (!provider || !provider.models.some((m) => m.id === fields.model)) {
    return json(res, 400, { error: '不支援的辨識模型，請在「模型設定」中重新選擇' });
  }
  if (!fields.key) return json(res, 400, { error: '缺少辨識 API Key（請在「模型設定」中填入）' });

  try {
    const result = await transcribe(
      { kind: provider.kind, baseUrl: provider.baseUrl, model: fields.model, key: fields.key },
      { rawBody: fileBuf, contentType: fileType, filename, language: fields.language || 'auto' }
    );
    return json(res, 200, result);
  } catch (e) {
    return json(res, 502, { error: e.message || '辨識失敗' });
  }
}

function splitMultipart(buf, boundary) {
  const marker = Buffer.from(`--${boundary}`);
  const out = [];
  let pos = 0;
  while (true) {
    const start = buf.indexOf(marker, pos);
    if (start === -1) break;
    const headerStart = start + marker.length;
    let p = headerStart;
    while (p + 1 < buf.length && !(buf[p] === 0x0d && buf[p + 1] === 0x0a)) p++;
    const headers = buf.slice(headerStart, p).toString('utf8');
    p += 2; // skip \r\n
    const next = buf.indexOf(marker, p);
    if (next === -1) break;
    let bodyEnd = next;
    if (bodyEnd - 2 >= p && buf[bodyEnd - 2] === 0x0d && buf[bodyEnd - 1] === 0x0a) bodyEnd -= 2;
    out.push({ headers, body: buf.slice(p, bodyEnd) });
    pos = next;
  }
  return out;
}