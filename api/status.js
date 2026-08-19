import { loadConfig, publicConfig } from './_lib/config.js';
import { json } from './_lib/util.js';

// 公開端點：只回傳目前使用的模型名稱（絕不含 Key）
export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method Not Allowed' });
  try {
    const cfg = await loadConfig();
    return json(res, 200, { ...publicConfig(cfg) });
  } catch (e) {
    return json(res, 500, { error: e.message || '讀取設定失敗' });
  }
}