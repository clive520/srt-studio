import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PROVIDERS, LANGUAGES, transcribe, segmentByAI } from './providers.js';
import {
  cleanSegments,
  buildSegmentsFromWords,
  buildSegmentsFromRanges,
  wordsToText,
  splitWordsAt,
  toSRT,
  downloadSRT,
  fmtTime,
} from './srt.js';
import { extractAudio, isVideoFile } from './audio.js';
import { convertSegments, OUTPUT_LANGS } from './lang.js';
import { useHistory } from './useHistory.js';
import Timeline from './Timeline.jsx';
import EditPanel from './EditPanel.jsx';
import { SHORTCUTS } from './shortcuts.js';

const LS = {
  provider: 'srt-studio:provider',
  key: 'srt-studio:key',
  lang: 'srt-studio:lang',
  outLang: 'srt-studio:outlang',
  segs: 'srt-studio:segs',
  zoom: 'srt-studio:zoom',
  preview: 'srt-studio:preview',
};

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function isTypingTarget(e) {
  const t = e.target;
  return (
    t &&
    (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
  );
}

function App() {
  const [providerId, setProviderId] = useState(() => load(LS.provider, 'groq'));
  const [apiKey, setApiKey] = useState(() => load(LS.key, ''));
  const [language, setLanguage] = useState(() => load(LS.lang, 'auto'));
  const [outputLang, setOutputLang] = useState(() => load(LS.outLang, 'traditional'));

  const [file, setFile] = useState(null);
  const [fileUrl, setFileUrl] = useState(null);
  const [fileName, setFileName] = useState('');
  const [isVideo, setIsVideo] = useState(false);

  const [audioBlob, setAudioBlob] = useState(null);
  const [audioName, setAudioName] = useState('');
  const [duration, setDuration] = useState(0);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const noticeTimer = useRef(null);

  const {
    state: segments,
    setState: setSegmentsRaw,
    commit: commitSegments,
    snapshot: snapshotSegments,
    undo,
    redo,
  } = useHistory(() => load(LS.segs, []));

  const [activeIdx, setActiveIdx] = useState(-1);
  const [playIdx, setPlayIdx] = useState(-1);
  const [dragging, setDragging] = useState(false);
  const [pxPerSec, setPxPerSec] = useState(() => load(LS.zoom, 40));
  const [showHelp, setShowHelp] = useState(false);
  const [previewCollapsed, setPreviewCollapsed] = useState(() => load(LS.preview, false));

  const mediaRef = useRef(null);
  const segsRef = useRef(segments);
  segsRef.current = segments;

  const provider = useMemo(
    () => PROVIDERS.find((p) => p.id === providerId) || PROVIDERS[0],
    [providerId]
  );

  useEffect(() => localStorage.setItem(LS.provider, JSON.stringify(providerId)), [providerId]);
  useEffect(() => localStorage.setItem(LS.key, JSON.stringify(apiKey)), [apiKey]);
  useEffect(() => localStorage.setItem(LS.lang, JSON.stringify(language)), [language]);
  useEffect(() => localStorage.setItem(LS.outLang, JSON.stringify(outputLang)), [outputLang]);
  useEffect(() => localStorage.setItem(LS.zoom, JSON.stringify(pxPerSec)), [pxPerSec]);
  useEffect(() => localStorage.setItem(LS.preview, JSON.stringify(previewCollapsed)), [previewCollapsed]);
  useEffect(() => {
    localStorage.setItem(LS.segs, JSON.stringify(segments));
  }, [segments]);

  // activeIdx 超出範圍時收斂
  useEffect(() => {
    if (segments.length && activeIdx >= segments.length) {
      setActiveIdx(segments.length - 1);
    } else if (!segments.length) {
      setActiveIdx(-1);
    }
  }, [segments.length, activeIdx]);

  useEffect(() => {
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    };
  }, [fileUrl]);

  const resetMedia = useCallback(() => {
    commitSegments([]);
    setActiveIdx(-1);
    setPlayIdx(-1);
    setAudioBlob(null);
    setAudioName('');
    setDuration(0);
  }, [commitSegments]);

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
    setProgress({ label: '正在辨識…', pct: 0.2 });
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
      commitSegments(await convertSegments(cleanSegments(built), outputLang));
      setActiveIdx(0);
      // 自動第二次 AI 分段：依 AI 決定的段界重建（失敗則保留上面的啟發式結果）
      if (result.words?.length >= 3) {
        setProgress({ label: 'AI 正在重新分段…', pct: 0.6 });
        try {
          const boundaries = await segmentByAI(provider, { key: apiKey.trim(), words: result.words });
          const rebuilt = buildSegmentsFromRanges(result.words, boundaries);
          if (rebuilt.length < 2) throw new Error('AI 分段結果無法使用');
          commitSegments(await convertSegments(cleanSegments(rebuilt), outputLang));
          setActiveIdx(0);
          setProgress({ label: `辨識完成，共 ${rebuilt.length} 段（AI 分段）`, pct: 1 });
        } catch (e2) {
          setError(`${e2.message || 'AI 分段失敗'}，已保留自動分段結果`);
          setProgress({ label: `辨識完成，共 ${built.length} 段`, pct: 1 });
        }
      } else {
        setProgress({ label: `辨識完成，共 ${built.length} 段`, pct: 1 });
      }
    } catch (e) {
      setError(e.message || '辨識失敗');
    } finally {
      setBusy(false);
    }
  }, [audioBlob, audioName, apiKey, provider, language, outputLang, commitSegments]);

  const updateSegment = useCallback(
    (idx, patch) => {
      commitSegments((prev) =>
        prev.map((s, i) => {
          if (i !== idx) return s;
          const next = { ...s, ...patch };
          if ('text' in patch) next.words = undefined; // 文字被改過，逐字時間對應失效
          return next;
        })
      );
    },
    [commitSegments]
  );

  const deleteSegment = useCallback(
    (idx) => {
      commitSegments((prev) => prev.filter((_, i) => i !== idx));
      setActiveIdx((a) => (a === idx ? Math.max(0, idx - 1) : a));
    },
    [commitSegments]
  );

  const moveSegment = useCallback(
    (idx, dir) => {
      commitSegments((prev) => {
        const next = [...prev];
        const j = idx + dir;
        if (j < 0 || j >= next.length) return prev;
        [next[idx], next[j]] = [next[j], next[idx]];
        return next;
      });
      setActiveIdx(idx + dir);
    },
    [commitSegments]
  );

  const mergeSegment = useCallback(
    (idx, dir) => {
      commitSegments((prev) => {
        if (prev.length < 2) return prev;
        if (dir === -1) {
          if (idx <= 0) return prev;
          const a = prev[idx - 1];
          const b = prev[idx];
          const next = [...prev];
          next.splice(idx - 1, 2, {
            start: a.start,
            end: b.end,
            text: `${a.text}${a.text ? ' ' : ''}${b.text}`.trim(),
            words: a.words && b.words ? [...a.words, ...b.words] : undefined,
          });
          return next;
        }
        if (dir === 1) {
          if (idx >= prev.length - 1) return prev;
          const a = prev[idx];
          const b = prev[idx + 1];
          const next = [...prev];
          next.splice(idx, 2, {
            start: a.start,
            end: b.end,
            text: `${a.text}${a.text ? ' ' : ''}${b.text}`.trim(),
            words: a.words && b.words ? [...a.words, ...b.words] : undefined,
          });
          return next;
        }
        return prev;
      });
      setActiveIdx(dir === -1 ? idx - 1 : idx);
    },
    [commitSegments]
  );

  const showNotice = useCallback((msg) => {
    setNotice(msg);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2500);
  }, []);

  const splitSegment = useCallback(
    (idx, caret) => {
      const seg = segsRef.current[idx];
      if (!seg) return;
      const text = seg.text;
      let sc = Math.max(0, Math.min(caret ?? -1, text.length));
      let t1 = text.slice(0, sc).trim();
      let t2 = text.slice(sc).trim();
      let fallback = false;
      if (!t1 || !t2) {
        const punct = Math.max(
          text.lastIndexOf('。'),
          text.lastIndexOf('！'),
          text.lastIndexOf('？'),
          text.lastIndexOf('.'),
          text.lastIndexOf('!'),
          text.lastIndexOf('?')
        );
        sc = punct > 0 ? punct + 1 : Math.floor(text.length / 2);
        t1 = text.slice(0, sc).trim();
        t2 = text.slice(sc).trim();
        fallback = true;
        if (!t1 || !t2) {
          setError('無法切分：文字為空或只有一個字');
          return;
        }
      }
      // 若逐字時間戳仍對得上文字，切點時間用「游標前最後一個字」的真實時間
      const wSplit =
        seg.words?.length && wordsToText(seg.words) === text ? splitWordsAt(seg.words, sc) : null;
      const splitTime =
        wSplit && wSplit.boundary != null
          ? Math.max(seg.start, Math.min(wSplit.boundary, seg.end))
          : seg.start + (seg.end - seg.start) * (sc / text.length);
      commitSegments((prev) => {
        if (!prev[idx]) return prev;
        const next = [...prev];
        next.splice(
          idx,
          1,
          { ...seg, text: t1, end: splitTime, words: wSplit?.left },
          { start: splitTime, end: seg.end, text: t2, words: wSplit?.right }
        );
        return next;
      });
      showNotice(
        wSplit
          ? '已切分為 2 段（依逐字時間精準切點）'
          : fallback
            ? '已切分（游標在文字邊界，自動改在句點後切）'
            : '已切分為 2 段'
      );
    },
    [commitSegments, showNotice]
  );

  const fixTimeline = useCallback(() => {
    commitSegments((prev) => cleanSegments(prev));
  }, [commitSegments]);

  // AI 重新分段：把逐字稿（含逐字時間）再送一次給 AI 決定段界，重建字幕段
  const aiSegments = useCallback(async () => {
    const all = [];
    for (const s of segsRef.current) {
      if (!s.words?.length) {
        setError('部分字幕的文字已被修改、失去逐字時間對應，請重新辨識後再使用 AI 分段');
        return;
      }
      all.push(...s.words);
    }
    if (all.length < 3) {
      setError('字詞數量不足（至少 3 個字），無法 AI 分段');
      return;
    }
    setBusy(true);
    setProgress({ label: 'AI 正在重新分段…', pct: 0.5 });
    try {
      const boundaries = await segmentByAI(provider, { key: apiKey.trim(), words: all });
      const rebuilt = buildSegmentsFromRanges(all, boundaries);
      if (rebuilt.length < 2) throw new Error('AI 分段結果無法使用，請再試一次');
      commitSegments(await convertSegments(cleanSegments(rebuilt), outputLang));
      setActiveIdx(0);
      showNotice(`已依 AI 分段重建 ${rebuilt.length} 段`);
    } catch (e) {
      setError(e.message || 'AI 分段失敗');
    } finally {
      setBusy(false);
    }
  }, [provider, apiKey, outputLang, commitSegments, showNotice]);

  const resizeLive = useCallback(
    (idx, patch) => {
      setSegmentsRaw((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
    },
    [setSegmentsRaw]
  );

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
    setPlayIdx(idx);
  }, []);

  const seekTo = useCallback((t) => {
    const m = mediaRef.current;
    if (m) {
      m.currentTime = t;
      m.play().catch(() => {});
    }
  }, []);

  const seekOnly = useCallback((t) => {
    const m = mediaRef.current;
    if (m) m.currentTime = t;
  }, []);

  const togglePlay = useCallback(() => {
    const m = mediaRef.current;
    if (!m) return;
    if (m.paused) m.play().catch(() => {});
    else m.pause();
  }, []);

  const playSegment = useCallback(
    (idx) => {
      const s = segsRef.current[idx];
      if (!s) return;
      const m = mediaRef.current;
      if (m) {
        m.currentTime = s.start;
        m.play().catch(() => {});
      }
    },
    []
  );

  const selectRel = useCallback(
    (d) => {
      setActiveIdx((a) => {
        const n = a + d;
        return n < 0 || n >= segsRef.current.length ? a : n;
      });
    },
    []
  );

  const nudgeTime = useCallback(
    (key, key2, delta) => {
      const a = activeIdx;
      const s = segsRef.current[a];
      if (!s) return;
      if (key2 === 'start') updateSegment(a, { start: Math.max(0, Math.round((s.start + delta) * 100) / 100) });
      else updateSegment(a, { end: Math.max(s.start + 0.1, Math.round((s.end + delta) * 100) / 100) });
    },
    [activeIdx, updateSegment]
  );

  const onFileInput = useCallback(
    (e) => {
      const f = e.target.files?.[0];
      if (f) handleFile(f);
      e.target.value = '';
    },
    [handleFile]
  );

  // 鍵盤快捷鍵
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setShowHelp((h) => !h);
        return;
      }
      if (e.key === 'Escape') {
        setShowHelp(false);
        return;
      }
      const typing = isTypingTarget(e);
      if (typing) {
        // 文字框內僅支援 S（切分）
        if ((e.key === 's' || e.key === 'S') && activeIdx >= 0) {
          e.preventDefault();
          const caret = document.activeElement?.selectionStart ?? 0;
          splitSegment(activeIdx, caret);
        }
        return;
      }
      if (!segments.length) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekOnly(mediaRef.current.currentTime + 0.5);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekOnly(mediaRef.current.currentTime - 0.5);
          break;
        case 'ArrowDown':
          e.preventDefault();
          selectRel(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          selectRel(-1);
          break;
        case 'Enter':
          e.preventDefault();
          if (activeIdx >= 0) playSegment(activeIdx);
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          if (activeIdx >= 0) deleteSegment(activeIdx);
          break;
        case 'm':
        case 'M':
          if (activeIdx >= 0) mergeSegment(activeIdx, e.shiftKey ? -1 : 1);
          break;
        case '[':
          e.preventDefault();
          nudgeTime('start', 'start', -0.1);
          break;
        case ']':
          e.preventDefault();
          nudgeTime('start', 'start', 0.1);
          break;
        case '{':
          e.preventDefault();
          nudgeTime('end', 'end', -0.1);
          break;
        case '}':
          e.preventDefault();
          nudgeTime('end', 'end', 0.1);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    activeIdx,
    segments.length,
    splitSegment,
    deleteSegment,
    mergeSegment,
    nudgeTime,
    selectRel,
    togglePlay,
    playSegment,
    seekOnly,
    undo,
    redo,
  ]);

  const getLiveTime = useCallback(() => mediaRef.current?.currentTime ?? 0, []);
  const getLivePlaying = useCallback(
    () => (mediaRef.current ? !mediaRef.current.paused : false),
    []
  );

  const currentText = playIdx >= 0 ? segments[playIdx]?.text : '';

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
          <label>
            輸出
            <select value={outputLang} onChange={(e) => setOutputLang(e.target.value)}>
              {OUTPUT_LANGS.map((l) => (
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

      {notice && (
        <div className="banner info">
          <span>✓ {notice}</span>
          <button onClick={() => setNotice(null)}>×</button>
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
              <div className={`media-box ${previewCollapsed ? 'collapsed' : ''}`}>
                <div className="media-head">
                  <span className="media-head-title">🎬 預覽</span>
                  <button
                    className="icon-btn"
                    title="收合預覽，專心編輯字幕"
                    onClick={() => setPreviewCollapsed(true)}
                  >
                    ⏷
                  </button>
                </div>
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
              {previewCollapsed && (
                <button
                  className="btn small restore-preview"
                  onClick={() => setPreviewCollapsed(false)}
                >
                  ▶ 顯示預覽
                </button>
              )}
            </div>

            <div className="right-col">
              <div className="file-bar">
              <span className="file-name" title={fileName}>
                {fileName}
              </span>
              <button className="btn primary" disabled={busy || !audioBlob} onClick={handleTranscribe}>
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
                className="btn"
                onClick={aiSegments}
                disabled={busy || !segments.length}
                title="把逐字稿再送給 AI 決定分段點，依真實字詞時間重建字幕段"
              >
                🤖 AI 重新分段
              </button>
              <button className="btn" onClick={undo} disabled={!segments.length}>
                ↩ 復原
              </button>
              <button className="btn" onClick={redo} disabled={!segments.length}>
                ↪ 重做
              </button>
              <button className="btn" onClick={() => setShowHelp(true)}>
                ? 快捷鍵
              </button>
              <button className="btn danger" onClick={() => commitSegments([])} disabled={!segments.length}>
                🗑 清空字幕
              </button>
              <span className="count">
                {segments.length} 段・{fmtTime(duration)}
              </span>
            </div>

            <Timeline
              audioBlob={audioBlob}
              duration={duration}
              segments={segments}
              pxPerSec={pxPerSec}
              setPxPerSec={setPxPerSec}
              currentTime={mediaRef.current?.currentTime ?? 0}
              getCurrentTime={getLiveTime}
              getPlaying={getLivePlaying}
              activeIdx={activeIdx}
              onSeek={seekOnly}
              onSelect={setActiveIdx}
              onResizeSegment={resizeLive}
              onResizeStart={snapshotSegments}
              onResizeEnd={() => {}}
              onDurationChange={setDuration}
            />

            <EditPanel
              segments={segments}
              activeIdx={activeIdx}
              onSelect={setActiveIdx}
              onSeek={seekOnly}
              onUpdate={updateSegment}
              onDelete={deleteSegment}
              onMove={moveSegment}
              onMerge={mergeSegment}
              onSplit={splitSegment}
              onPlay={playSegment}
            />
            </div>
          </section>
        )}
      </main>

      {showHelp && (
        <div className="modal-overlay" onClick={() => setShowHelp(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>⌨️ 鍵盤快捷鍵</h2>
              <button className="icon-btn" onClick={() => setShowHelp(false)}>✕</button>
            </div>
            <table className="shortcut-table">
              <tbody>
                {SHORTCUTS.map((s, i) => (
                  <tr key={i}>
                    <td className="keys">
                      {s.keys.map((k) => (
                        <kbd key={k}>{k}</kbd>
                      ))}
                    </td>
                    <td>{s.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="modal-hint">
              提示：在時間軸上可直接拖曳字幕塊左右邊緣來調整起訖時間；按住邊緣拖曳即可。
            </p>
          </div>
        </div>
      )}

      <footer>
        Key 只存於你的瀏覽器（localStorage），語音直接送往你選擇的供應商，本站不會留存你的檔案與字幕。
      </footer>
    </div>
  );
}

export default App;