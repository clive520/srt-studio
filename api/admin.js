import { CATALOG, findModel } from './_lib/catalog.js';
import { loadConfig, saveConfig, loadPassword, publicConfig } from './_lib/config.js';
import { json, readBody, timingSafeEqual } from './_lib/util.js';

const MAX_BODY = 256 * 1024;

async function authorized(req) {
  const pw = await loadPassword();
  if (!pw) return false;
  const given = req.headers['x-admin-password'] || '';
  return timingSafeEqual(pw, given);
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (!(await authorized(req))) return json(res, 401, { error: '密碼錯誤' });
    try {
      const cfg = await loadConfig();
      return json(res, 200, { ...cfg, catalog: CATALOG });
    } catch (e) {
      return json(res, 500, { error: e.message || '讀取設定失敗' });
    }
  }

  if (req.method === 'PUT') {
    if (!(await authorized(req))) return json(res, 401, { error: '密碼錯誤' });
    let body;
    try {
      body = JSON.parse((await readBody(req, MAX_BODY)).toString('utf8') || '{}');
    } catch {
      return json(res, 400, { error: '無法解析請求內容' });
    }
    if (!body || typeof body !== 'object') return json(res, 400, { error: '格式錯誤' });

    const cur = await loadConfig();
    const next = {
      stt: { ...cur.stt },
      seg: { ...cur.seg },
      password: body.password === undefined ? cur.password : String(body.password).trim(),
    };

    for (const role of ['stt', 'seg']) {
      const r = body[role];
      if (!r) continue;
      if (r.provider && !findModel(role, r.provider, r.model)) {
        return json(res, 400, { error: `不支援的${role === 'stt' ? '辨識' : '分段'}模型組合` });
      }
      if (r.provider) next[role].provider = r.provider;
      if (r.model) next[role].model = r.model;
      if (r.key !== undefined) {
        const k = String(r.key).trim();
        if (k && k !== '******') next[role].key = k; // '******' = 保留原 Key
      }
    }

    const saved = await saveConfig(next);
    if (!saved && !process.env.KV_REST_API_URL) {
      return json(res, 500, { error: '無法儲存：伺服器未設定 KV 儲存（請設定 KV_REST_API_URL / KV_REST_API_TOKEN，或用環境變數 STT_KEY/SEG_KEY 等）' });
    }
    if (!saved && process.env.KV_REST_API_URL) {
      return json(res, 500, { error: '儲存失敗（KV 連線問題）' });
    }
    return json(res, 200, { ok: true, ...publicConfig(next) });
  }

  return json(res, 405, { error: 'Method Not Allowed' });
}