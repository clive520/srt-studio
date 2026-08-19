import { useCallback, useEffect, useState } from 'react';
import { adminGet, adminPut } from './api.js';

const KEEP_KEY = '******';

function RoleForm({ role, title, desc, value, catalog, onSave, saving }) {
  const [providerId, setProviderId] = useState(value.provider);
  const [modelId, setModelId] = useState(value.model);
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState(null);

  const provider = (catalog[role] || []).find((p) => p.id === providerId) || (catalog[role] || [])[0];
  const models = provider?.models || [];

  // 切換供應商時自動挑第一個模型
  useEffect(() => {
    if (provider && !models.some((m) => m.id === modelId)) {
      setModelId(models[0]?.id || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  const save = async () => {
    setMsg(null);
    try {
      const payload = { [role]: { provider: providerId, model: modelId } };
      if (key.trim()) payload[role].key = key.trim();
      else payload[role].key = value.hasKey ? KEEP_KEY : '';
      await onSave(payload);
      setKey('');
      setMsg({ ok: true, text: '已儲存' });
    } catch (e) {
      setMsg({ ok: false, text: e.message || '儲存失敗' });
    }
  };

  return (
    <section className="admin-card">
      <h3>{title}</h3>
      <p className="admin-desc">{desc}</p>
      <div className="admin-row">
        <label>
          供應商
          <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            {(catalog[role] || []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.free ? '（免費）' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          模型
          <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="key-label">
          API Key
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={value.hasKey ? '已設定（留空＝沿用）' : '尚未設定'}
          />
        </label>
        {provider?.keyUrl && (
          <a className="key-link" href={provider.keyUrl} target="_blank" rel="noreferrer">
            取得 Key ↗
          </a>
        )}
      </div>
      <div className="admin-models">
        {models.map((m) => (
          <span key={m.id} className="model-chip">
            {m.name}：{m.note}
          </span>
        ))}
      </div>
      <div className="admin-save">
        <button className="btn primary" onClick={save} disabled={saving}>
          {saving ? '儲存中…' : '儲存'}
        </button>
        {msg && <span className={msg.ok ? 'ok' : 'err'}>{msg.text}</span>}
      </div>
    </section>
  );
}

export default function AdminPage() {
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const login = useCallback(async () => {
    setError(null);
    try {
      const data = await adminGet(password);
      setConfig(data);
      setAuthed(true);
    } catch (e) {
      setError(e.message || '無法登入');
    }
  }, [password]);

  const handleSave = useCallback(
    async (payload) => {
      setSaving(true);
      try {
        const res = await adminPut(password, payload);
        const cur = await adminGet(password);
        setConfig(cur);
        return res;
      } finally {
        setSaving(false);
      }
    },
    [password]
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">⚙️</span>
          <div>
            <h1>字幕工坊・系統後台</h1>
            <p className="tagline">設定辨識與分段模型；設定後一般使用者無需再填 Key</p>
          </div>
        </div>
        <a className="btn small" href="#/">← 返回主頁</a>
      </header>

      {error && (
        <div className="banner error">
          <span>⚠️ {error}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <main>
        {!authed ? (
          <section className="admin-login">
            <h2>管理員登入</h2>
            <p className="hint">請輸入後台密碼（由網站管理員在伺服器端設定）。</p>
            <div className="admin-login-row">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && login()}
                placeholder="後台密碼"
              />
              <button className="btn primary" onClick={login}>
                進入後台
              </button>
            </div>
          </section>
        ) : (
          <section className="admin-cards">
            <RoleForm
              role="stt"
              title="🎙 語音辨識（字幕檔）"
              desc="將上傳的聲音轉成逐字稿（需支援逐字時間戳，才能精準對齊字幕）。"
              value={config.stt}
              catalog={config.catalog}
              onSave={handleSave}
              saving={saving}
            />
            <RoleForm
              role="seg"
              title="✂️ 句子分段（AI 重新分段）"
              desc="決定每句字幕在哪裡切開；需能輸出 JSON 的語言模型。預設 DeepSeek V4 Flash。"
              value={config.seg}
              catalog={config.catalog}
              onSave={handleSave}
              saving={saving}
            />
            <p className="hint admin-hint">
              目前上線中的設定：辨識＝{config.stt.providerName}・{config.stt.modelName}
              （{config.stt.hasKey ? '已設 Key' : '未設 Key'}）｜分段＝{config.seg.providerName}・
              {config.seg.modelName}（{config.seg.hasKey ? '已設 Key' : '未設 Key'}）
            </p>
          </section>
        )}
      </main>

      <footer>Key 只儲存在伺服器端（Vercel KV 或環境變數），一般使用者看不到。</footer>
    </div>
  );
}