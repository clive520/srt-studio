import { useMemo, useState } from 'react';

function ModelSection({ role, title, icon, desc, config, onChange, catalog, showKeys }) {
  const providers = catalog[role] || [];
  const provider = providers.find((p) => p.id === config.provider) || providers[0];
  const models = provider?.models || [];

  const setProvider = (pid) => {
    const p = providers.find((x) => x.id === pid);
    const first = p?.models?.[0]?.id || '';
    onChange({ ...config, provider: pid, model: first });
  };

  return (
    <section className="settings-card">
      <h3>
        {icon} {title}
      </h3>
      <p className="settings-desc">{desc}</p>
      <div className="settings-rows">
        <label>
          供應商
          <select value={config.provider || provider?.id} onChange={(e) => setProvider(e.target.value)}>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.free ? '（免費）' : '（付費）'}
              </option>
            ))}
          </select>
        </label>
        <label>
          模型
          <select
            value={models.some((m) => m.id === config.model) ? config.model : models[0]?.id}
            onChange={(e) => onChange({ ...config, model: e.target.value })}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="key-label">
          {provider?.free ? 'API Key（免費）' : 'API Key'}
          <input
            type={showKeys ? 'text' : 'password'}
            value={config.key}
            onChange={(e) => onChange({ ...config, key: e.target.value })}
            placeholder={provider?.free ? '填入免費 Key（如 Groq/NVIDIA 的）' : '填入此供應商的 Key'}
          />
        </label>
        {provider?.keyUrl && (
          <a className="key-link" href={provider.keyUrl} target="_blank" rel="noreferrer">
            取得 Key ↗
          </a>
        )}
      </div>
      <div className="settings-models">
        {models.map((m) => (
          <span key={m.id} className={`model-chip ${m.id === config.model ? 'active' : ''}`}>
            {m.name}：{m.note}
          </span>
        ))}
      </div>
    </section>
  );
}

export default function SettingsPanel({ catalog, stt, seg, setStt, setSeg, onClose }) {
  const [showKeys, setShowKeys] = useState(false);
  const freeStt = useMemo(
    () => (catalog?.stt || []).filter((p) => p.free),
    [catalog]
  );
  const freeSeg = useMemo(
    () => (catalog?.seg || []).filter((p) => p.free),
    [catalog]
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>🔧 模型設定</h2>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="settings-intro">
          本站需要兩組模型，各別使用自己的 API Key（兩把 Key 可來自不同供應商）：
        </p>
        <ModelSection
          role="stt"
          title="1. 聲音變文字（含時間點）"
          icon="🎙"
          desc="把上傳的聲音轉成逐字稿，並附上每個字的時間點，字幕才能對準聲音。需要「語音辨識（STT）」模型。"
          config={stt}
          onChange={setStt}
          catalog={catalog}
          showKeys={showKeys}
        />
        <ModelSection
          role="seg"
          title="2. 句子分段"
          icon="✂️"
          desc="辨識完成後，依句意決定每句字幕在哪裡切開。需要能輸出 JSON 的「語言模型（LLM）」。"
          config={seg}
          onChange={setSeg}
          catalog={catalog}
          showKeys={showKeys}
        />
        <div className="settings-legend">
          <span>✅ 免費額度：{[...freeStt, ...freeSeg].map((p) => p.name).join('、')}</span>
          <span>💳 付費：其餘供應商（多數有試用額度）</span>
        </div>
        <div className="settings-hint">
          <label className="show-keys">
            <input type="checkbox" checked={showKeys} onChange={(e) => setShowKeys(e.target.checked)} />
            暫時顯示 Key（一般建議隱藏）
          </label>
        </div>
        <div className="settings-foot">
          <span>設定會存在你的瀏覽器（localStorage），不會上傳到本站伺服器。</span>
          <button className="btn primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}