import { providerLabel } from './catalog.js';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KV_KEY = 'srt-studio:config';

export const DEFAULTS = {
  stt: { provider: 'groq', model: 'whisper-large-v3-turbo', key: '' },
  seg: { provider: 'opencode-go', model: 'deepseek-v4-flash', key: '' },
};

function envConfig() {
  const pick = (prefix, d) => ({
    provider: process.env[`${prefix}_PROVIDER`] || d.provider,
    model: process.env[`${prefix}_MODEL`] || d.model,
    key: process.env[`${prefix}_KEY`] || d.key || '',
  });
  return { stt: pick('STT', DEFAULTS.stt), seg: pick('SEG', DEFAULTS.seg), password: '' };
}

function normalize(cfg) {
  return {
    stt: { ...DEFAULTS.stt, ...(cfg?.stt || {}) },
    seg: { ...DEFAULTS.seg, ...(cfg?.seg || {}) },
    password: cfg?.password || '',
  };
}

export async function loadConfig() {
  if (KV_URL && KV_TOKEN) {
    try {
      const res = await fetch(`${KV_URL}/get/${KV_KEY}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
      });
      if (res.ok) {
        const { result } = await res.json();
        if (result) return normalize(JSON.parse(result));
      }
    } catch {
      /* 落到 env fallback */
    }
  }
  return envConfig();
}

export async function saveConfig(cfg) {
  if (!KV_URL || !KV_TOKEN) return false;
  const res = await fetch(`${KV_URL}/set/${KV_KEY}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(JSON.stringify(cfg)),
  });
  return res.ok;
}

export async function loadPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (KV_URL && KV_TOKEN) {
    try {
      const res = await fetch(`${KV_URL}/get/${KV_KEY}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
      });
      if (res.ok) {
        const { result } = await res.json();
        if (result) return JSON.parse(result).password || '';
      }
    } catch {
      /* ignore */
    }
  }
  return '';
}

// 對外只公開模型名稱，絕不含 Key
export function publicConfig(cfg) {
  const pub = (role, d) => {
    const lbl = providerLabel(role, d.provider, d.model) || {};
    return {
      provider: d.provider,
      model: d.model,
      providerName: lbl.providerName || d.provider,
      modelName: lbl.modelName || d.model,
      keyUrl: lbl.keyUrl || '',
      hasKey: !!d.key,
    };
  };
  return { stt: pub('stt', cfg.stt), seg: pub('seg', cfg.seg) };
}