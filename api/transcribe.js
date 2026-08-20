import { findProvider } from './_lib/catalog.js';
import { transcribe } from './_lib/transcribe.js';
import { json } from './_lib/util.js';

export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method Not Allowed' });

  const contentType = req.headers['content-type'] || '';
  const boundary = contentType.match(/boundary="?([^";]+)"?/)?.[1] || '';
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
    const name = partName(part);
    if (name === 'file') {
      fileBuf = part.body;
      fileType = partType(part);
      filename = partFilename(part) || 'audio';
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
  while (pos < buf.length) {
    const start = buf.indexOf(marker, pos);
    if (start === -1) break;
    const after = start + marker.length;
    if (buf[after] === 0x2d && buf[after + 1] === 0x2d) break; // 結尾 marker（--boundary--）
    let p = after;
    if (buf[p] === 0x0d && buf[p + 1] === 0x0a) p += 2; // 跳過 marker 後的 \r\n
    const headerEnd = buf.indexOf(Buffer.from('\r\n\r\n'), p);
    if (headerEnd === -1) break;
    const headers = buf.slice(p, headerEnd).toString('utf8');
    p = headerEnd + 4;
    const next = buf.indexOf(marker, p);
    if (next === -1) break;
    let bodyEnd = next;
    if (bodyEnd - 2 >= p && buf[bodyEnd - 2] === 0x0d && buf[bodyEnd - 1] === 0x0a) bodyEnd -= 2;
    out.push({ headers, body: buf.slice(p, bodyEnd) });
    pos = next;
  }
  return out;
}

function partName(part) {
  const cd = part.headers.split(/\r\n/).find((l) => l.startsWith('Content-Disposition')) || '';
  return cd.match(/name="([^"]+)"/)?.[1] || null;
}

function partFilename(part) {
  const cd = part.headers.split(/\r\n/).find((l) => l.startsWith('Content-Disposition')) || '';
  return cd.match(/filename="([^"]*)"/)?.[1] || null;
}

function partType(part) {
  const ct = part.headers.split(/\r\n/).find((l) => l.toLowerCase().startsWith('content-type:'));
  return ct ? ct.slice(ct.indexOf(':') + 1).trim() : 'application/octet-stream';
}