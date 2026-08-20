import { CATALOG } from './_lib/catalog.js';
import { json } from './_lib/util.js';

// 公開端點：模型目錄（含免費/付費標示與說明），不含任何 Key
export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method Not Allowed' });
  return json(res, 200, { catalog: CATALOG });
}