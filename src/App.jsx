import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PROVIDERS, LANGUAGES, transcribe } from './providers.js';
import {
  cleanSegments,
  buildSegmentsFromWords,
  toSRT,
  downloadSRT,
  fmtTime,
} from './srt.js';
import { extractAudio, isVideoFile } from './audio.js';

const LS = {
  provider: 'srt-studio:provider',
  key: 'srt-studio:key',
  lang: 'srt-studio:lang',
  segs: 'srt-studio:segs',
};

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function App() {
  const [providerId, setProviderId] = useState(() => load(LS.provider, 'groq'));
  const [apiKey, setApiKey] = useState(() => load(LS.key, ''));
  const [language, setLanguage] = useState(() => load(LS.lang, 'auto'));

  const [file, setFile] = useState(null);
  const [fileUrl, setFileUrl] = useState(null);
  const [fileName, setFileName] = useState('');
  const [isVideo, setIsVideo] = useState(false);

  const [audioBlob, setAudioBlob] = useState(null);
  const [audioName, setAudioName] = useState('');

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  const [segments, setSegments] = useState(() => load(LS.segs, []));
  const [activeIdx, setActiveIdx] = useState(-1);
  const [dragging, setDragging] = useState(false);

  const mediaRef = useRef(null);
  const listRef = useRef(null);
  const rowRefs = useRef([]);
  const segsRef = useRef(segments);
  segsRef.current = segments;

  const provider = useMemo(
    () => PROVIDERS.find((p) => p.id === providerId) || PROVIDERS[0],
    [providerId]
  );

  useEffect(() => localStorage.setItem(LS.provider, JSON.stringify(providerId)), [providerId]);
  useEffect(() => localStorage.setItem(LS.key, JSON.stringify(apiKey)), [apiKey]);
  useEffect(() => localStorage.setItem(LS.lang, JSON.stringify(language)), [language]);
  useEffect(() => {
    localStorage.setItem(LS.segs, JSON.stringify(segments));
  }, [segments]);

  useEffect(() => {
    if (activeIdx >= 0) {
      rowRefs.current[activeIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeIdx]);

  useEffect(() => {
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    };
  }, [fileUrl]);

  const resetMedia = useCallback(() => {
    setSegments([]);
    setActiveIdx(-1);
    setAudioBlob(null);
    setAudioName('');
  }, []);

  const handleFile = useCallback(
    async (f) => {
      if (!f) return;
      setError(null);
      setProgress(null);
      resetMedia();

      const video = isVideoFile(f);
      setFile(f);
      setFileName(f.name);
      setIsVideo(video);
      setFileUrl(URL.createObjectURL(f));

      if (video) {
        setBusy(true);
        setProgress({ label: '正在從影片抽取音軌…', pct: 0 });
        try {
          const blob = await extractAudio(f, (p) =>
            setProgress({ label: '正在從影片抽取音軌…', pct: p })
          );
          setAudioBlob(blob);
          setAudioName('audio.mp3');
          setProgress({ label: '音軌抽取完成，可以開始辨識', pct: 1 });
        } catch (e) {
          setError(e?.message || '音軌抽取失敗');
        } finally {
          setBusy(false);
        }
      } else {
        setAudioBlob(f);
        setAudioName(f.name);
      }
    },
    [resetMedia]
  );

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const handleTranscribe = useCallback(async () => {
    if (!audioBlob) {
      setError('請先上傳音檔或影片');
      return;
    }
    if (!apiKey.trim()) {
      setError('請先填入 API Key');
      return;
    }
    setError(null);
    setBusy(true);
    const pct = { label: '正在辨識…', pct: 0.2 };
    setProgress(pct);
    try {
      const result = await transcribe(provider, {
        blob: audioBlob,
        filename: audioName || 'audio.mp3',
        key: apiKey.trim(),
        language,
        onProgress: (s) => setProgress({ label: `辨識中：${s.status}`, pct: 0.2 }),
      });

      const built = result.words?.length
        ? buildSegmentsFromWords(result.words)
        : result.segments;
      setSegments(cleanSegments(built));
      setProgress({ label: `辨識完成，共 ${built.length} 段`, pct: 1 });
    } catch (e) {
      setError(e.message || '辨識失敗');
    } finally {
      setBusy(false);
    }
  }, [audioBlob, audioName, apiKey, provider, language]);

  const updateSegment = useCallback((idx, patch) => {
    setSegments((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }, []);

  const addSegment = useCallback((idx) => {
    setSegments((prev) => {
      const base = prev[idx] || { start: 0, end: 1, text: '' };
      const prevEnd = idx >= 0 ? prev[idx]?.start ?? 0 : 0;
      const next = [...prev];
      next.splice(idx + 1, 0, {
        start: prevEnd,
        end: Math.max(prevEnd + 0.5, base.start),
        text: '',
      });
      return next;
    });
  }, []);

  const deleteSegment = useCallback((idx) => {
    setSegments((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const moveSegment = useCallback((idx, dir) => {
    setSegments((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }, []);

  const mergeNext = useCallback((idx) => {
    setSegments((prev) => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      const a = next[idx];
      const b = next[idx + 1];
      next.splice(idx, 2, {
        start: a.start,
        end: b.end,
        text: `${a.text}${a.text ? ' ' : ''}${b.text}`.trim(),
      });
      return next;
    });
  }, []);

  const fixTimeline = useCallback(() => {
    setSegments((prev) => cleanSegments(prev));
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const t = mediaRef.current?.currentTime ?? 0;
    const segs = segsRef.current;
    let idx = -1;
    for (let i = segs.length - 1; i >= 0; i--) {
      if (t >= segs[i].start && t < segs[i].end) {
        idx = i;
        break;
      }
    }
    setActiveIdx(idx);
  }, []);

  const seekTo = useCallback((t) => {
    const m = mediaRef.current;
    if (m) {
      m.currentTime = t;
      m.play().catch(() => {});
    }
  }, []);

  const onFileInput = useCallback(
    (e) => {
      const f = e.target.files?.[0];
      if (f) handleFile(f);
      e.target.value = '';
    },
    [handleFile]
  );

  const currentText = activeIdx >= 0 ? segments[activeIdx]?.text : '';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">🎬</span>
          <div>
            <h1>字幕工坊</h1>
            <p className="tagline">上傳聲音 → 自動辨識 → 編輯 → 下載 SRT</p>
          </div>
        </div>
        <div className="settings">
          <label>
            供應商
            <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="key-label">
            API Key
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={`在此填入 ${provider.name} 的 Key`}
            />
          </label>
          <label>
            語言
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <a className="key-link" href={provider.keyUrl} target="_blank" rel="noreferrer">
            取得 Key ↗
          </a>
        </div>
        <p className="provider-note">{provider.note}</p>
      </header>

      {error && (
        <div className="banner error">
          <span>⚠️ {error}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <main>
        {!file ? (
          <div
            className={`dropzone ${dragging ? 'dragging' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById('file-input').click()}
          >
            <input
              id="file-input"
              type="file"
              accept="audio/*,video/*,.mp3,.wav,.m4a,.ogg,.flac,.mp4,.mov,.mkv,.webm,.avi"
              onChange={onFileInput}
            />
            <div className="dropzone-inner">
              <div className="dropzone-icon">📁</div>
              <p>
                拖曳音檔或影片到這裡，或<strong>點此選擇檔案</strong>
              </p>
              <p className="hint">
                支援 mp3 / wav / m4a / ogg / mp4 / mov / webm… 影片會自動抽取聲音，不上傳影像
              </p>
            </div>
          </div>
        ) : (
          <section className="workspace">
            <div className="stage">
              <div className="media-box">
                {isVideo ? (
                  <video
                    ref={mediaRef}
                    src={fileUrl}
                    controls
                    preload="metadata"
                    onTimeUpdate={handleTimeUpdate}
                  />
                ) : (
                  <audio
                    ref={mediaRef}
                    src={fileUrl}
                    controls
                    preload="metadata"
                    onTimeUpdate={handleTimeUpdate}
                  />
                )}
                <div className={`caption-preview ${currentText ? 'show' : ''}`}>
                  {currentText || '（播放時會在此即時顯示字幕）'}
                </div>
              </div>

              <div className="file-bar">
                <span className="file-name" title={fileName}>
                  {fileName}
                </span>
                <button
                  className="btn primary"
                  disabled={busy || !audioBlob}
                  onClick={handleTranscribe}
                >
                  {busy ? '處理中…' : segments.length ? '重新辨識' : '開始辨識'}
                </button>
                <button className="btn" onClick={() => { setFile(null); setFileUrl(null); }}>
                  更換檔案
                </button>
              </div>

              {busy && progress && (
                <div className="progress">
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${Math.round((progress.pct ?? 0) * 100)}%` }}
                    />
                  </div>
                  <span>{progress.label}</span>
                </div>
              )}

              <div className="toolbar">
                <button className="btn" onClick={() => downloadSRT(segments)} disabled={!segments.length}>
                  ⬇ 下載 .srt
                </button>
                <button
                  className="btn"
                  onClick={() => navigator.clipboard.writeText(toSRT(segments))}
                  disabled={!segments.length}
                >
                  📋 複製
                </button>
                <button className="btn" onClick={fixTimeline} disabled={!segments.length}>
                  🔧 修正時間軸
                </button>
                <button
                  className="btn danger"
                  onClick={() => setSegments([])}
                  disabled={!segments.length}
                >
                  🗑 清空字幕
                </button>
                <span className="count">
                  {segments.length} 段・共 {fmtTime(segments.reduce((a, s) => a + (s.end - s.start), 0))} 秒
                </span>
              </div>
            </div>

            <div className="list-pane">
              <div className="list-head">
                <span>字幕編輯</span>
                <button className="btn small" onClick={() => addSegment(segments.length - 1)} disabled={!segments.length}>
                  ＋ 新增
                </button>
              </div>
              {!segments.length ? (
                <p className="empty">
                  辨識完成後，字幕會列在這裡。點擊任一列可跳到該時間。
                </p>
              ) : (
                <div className="seg-list" ref={listRef}>
                  {segments.map((s, i) => (
                    <div
                      key={i}
                      ref={(el) => (rowRefs.current[i] = el)}
                      className={`seg-row ${i === activeIdx ? 'active' : ''}`}
                    >
                      <div className="seg-time">
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={Math.round(s.start * 100) / 100}
                          onChange={(e) => updateSegment(i, { start: +e.target.value || 0 })}
                        />
                        <span className="sep">→</span>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={Math.round(s.end * 100) / 100}
                          onChange={(e) => updateSegment(i, { end: +e.target.value || 0 })}
                        />
                        <button className="icon-btn" title="跳到這個時間" onClick={() => seekTo(s.start)}>
                          ▶
                        </button>
                      </div>
                      <textarea
                        rows="2"
                        value={s.text}
                        onChange={(e) => updateSegment(i, { text: e.target.value })}
                        onFocus={() => seekTo(s.start)}
                      />
                      <div className="seg-actions">
                        <button className="icon-btn" title="上移" onClick={() => moveSegment(i, -1)}>↑</button>
                        <button className="icon-btn" title="下移" onClick={() => moveSegment(i, 1)}>↓</button>
                        <button className="icon-btn" title="合併到下一段" onClick={() => mergeNext(i)}>⇄</button>
                        <button className="icon-btn" title="下方新增" onClick={() => addSegment(i)}>＋</button>
                        <button className="icon-btn danger" title="刪除" onClick={() => deleteSegment(i)}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
      </main>

      <footer>
        Key 只存於你的瀏覽器（localStorage），語音直接送往你選擇的供應商，本站不會留存你的檔案與字幕。
      </footer>
    </div>
  );
}

export default App;