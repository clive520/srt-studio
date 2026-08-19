import { loadConfig } from './_lib/config.js';
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

  const cfg = await loadConfig();
  const seg = cfg.seg;
  if (!seg.key) return json(res, 400, { error: '分段模型尚未設定 API Key（請管理員至後台設定）' });
  const p = findProvider('seg', seg.provider);
  if (!p) return json(res, 400, { error: '分段供應商設定無效' });

  try {
    const boundaries = await segmentByAI(
      { kind: p.kind, baseUrl: p.baseUrl, model: seg.model, key: seg.key },
      { words }
    );
    return json(res, 200, { boundaries });
  } catch (e) {
    return json(res, 502, { error: e.message || 'AI 分段失敗' });
  }
}