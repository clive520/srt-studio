import { findProvider } from './_lib/catalog.js';
import { segmentByAI } from './_lib/segment.js';
import { json, readBody } from './_lib/util.js';

export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method Not Allowed' });
  let body;
  try {
    body = JSON.parse((await readBody(req, 10 * 1024 * 1024)).toString('utf8') || '{}');
  } catch {
    return json(res, 400, { error: '無法解析請求內容' });
  }
  const words = Array.isArray(body?.words) ? body.words : null;
  if (!words) return json(res, 400, { error: '缺少逐字稿（words）' });

  const provider = findProvider('seg', body.provider);
  if (!provider || !provider.models.some((m) => m.id === body.model)) {
    return json(res, 400, { error: '不支援的分段模型，請在「模型設定」中重新選擇' });
  }
  if (!body.key) return json(res, 400, { error: '缺少分段 API Key（請在「模型設定」中填入）' });

  try {
    const boundaries = await segmentByAI(
      { kind: provider.kind, baseUrl: provider.baseUrl, model: body.model, key: body.key },
      { words }
    );
    return json(res, 200, { boundaries });
  } catch (e) {
    return json(res, 502, { error: e.message || 'AI 分段失敗' });
  }
}