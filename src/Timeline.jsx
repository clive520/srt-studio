import { useEffect, useRef, useState } from 'react';
import { fmtTime } from './srt.js';

const MAX_BUCKETS = 24000;
const BUCKETS_PER_SEC = 240;

/**
 * 音軌時間軸：上方波形（canvas，僅渲染可見區間），下方字幕塊，共用同一時間軸。
 * 支援縮放、點擊跳轉、點選字幕、拖曳字幕邊緣調整起訖時間。
 */
export default function Timeline({
  audioBlob,
  duration,
  segments,
  pxPerSec,
  setPxPerSec,
  currentTime,
  getCurrentTime,
  activeIdx,
  onSeek,
  onSelect,
  onResizeSegment,
  onResizeStart,
  onResizeEnd,
  onDurationChange,
}) {
  const scrollRef = useRef(null);
  const canvasRef = useRef(null);
  const blocksRef = useRef(null);
  const playheadRef = useRef(null);
  const [peaks, setPeaks] = useState(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const dragRef = useRef(null);
  const suppressScrollRef = useRef(false);

  // 解碼音檔並計算峰值
  useEffect(() => {
    if (!audioBlob) {
      setPeaks(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const ctx = new OfflineAudioContext(1, 1, 44100);
        const audioBuf = await ctx.decodeAudioData(await audioBlob.arrayBuffer());
        if (cancelled) return;
        onDurationChange?.(audioBuf.duration);
        const data = audioBuf.getChannelData(0);
        const count = Math.min(MAX_BUCKETS, Math.max(400, Math.ceil(audioBuf.duration * BUCKETS_PER_SEC)));
        const min = new Float32Array(count);
        const max = new Float32Array(count);
        for (let i = 0; i < count; i++) {
          const s0 = Math.floor((i / count) * data.length);
          const s1 = Math.max(s0 + 1, Math.floor(((i + 1) / count) * data.length));
          let lo = 1;
          let hi = -1;
          for (let j = s0; j < s1; j++) {
            const v = data[j];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
          min[i] = lo;
          max[i] = hi;
        }
        setPeaks({ min, max, count });
      } catch (e) {
        console.error('波形解碼失敗', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [audioBlob]); // eslint-disable-line react-hooks/exhaustive-deps

  const contentWidth = Math.max(duration * pxPerSec, 200);

  // 只重繪可見視窗的波形
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // 畫布與內容同寬（contentWidth），直接以內容座標繪製，捲動時跟著捲動才不會與字幕塊錯位
    const startX = Math.max(0, Math.floor(scrollLeft));
    const endX = Math.min(Math.ceil(scrollLeft + w), Math.ceil(contentWidth));
    ctx.fillStyle = 'rgba(139, 147, 167, 0.75)';
    const mid = h / 2;
    for (let x = startX; x < endX; x++) {
      const idx = Math.min(peaks.count - 1, Math.floor((x / contentWidth) * peaks.count));
      const y0 = mid - Math.min(1, Math.max(-1, peaks.max[idx])) * (h / 2);
      const y1 = mid - Math.min(1, Math.max(-1, peaks.min[idx])) * (h / 2);
      ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
  }, [peaks, pxPerSec, scrollLeft, contentWidth]);

  // 播放頭：用 rAF 每幀讀取即時時間，順暢移動 DOM 播放頭（避免隨 React 重繪而跳動）
  useEffect(() => {
    const playhead = playheadRef.current;
    if (!playhead) return;
    let raf;
    let lastPx = -1;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const t = getCurrentTime ? getCurrentTime() : currentTime;
      const px = t * pxPerSec;
      if (Math.abs(px - lastPx) < 0.5) return;
      lastPx = px;
      playhead.style.left = `${px}px`;
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [getCurrentTime, currentTime, pxPerSec]);

  const seekFromEvent = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft;
    onSeek(Math.max(0, Math.min(x / pxPerSec, duration)));
  };

  const blockPointerDown = (e, i) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const mode = offX < 10 ? 'start' : offX > rect.width - 10 ? 'end' : 'select';
    // 用滑鼠點選/拖曳字幕塊時不自動捲動，避免選取後位置位移干擾接下來的拖曳
    suppressScrollRef.current = true;
    if (mode === 'select') {
      onSelect(i);
      return;
    }
    e.stopPropagation();
    onSelect(i);
    onResizeStart();
    dragRef.current = { i, mode };
    const move = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const scroll = scrollRef.current;
      const rect2 = scroll.getBoundingClientRect();
      const x = ev.clientX - rect2.left + scroll.scrollLeft;
      const t = Math.max(0, Math.min(x / pxPerSec, duration));
      const seg = segments[d.i];
      if (!seg) return;
      if (d.mode === 'start') onResizeSegment(d.i, { start: Math.min(t, seg.end - 0.1) });
      else onResizeSegment(d.i, { end: Math.max(t, seg.start + 0.1) });
    };
    const up = () => {
      dragRef.current = null;
      onResizeEnd();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const zoomBy = (factor) => {
    setPxPerSec((p) => Math.max(8, Math.min(400, Math.round(p * factor))));
  };

  // 選中段自動捲入可見範圍（僅鍵盤/面板選取時；滑鼠點選已可見，不捲以免位移）
  useEffect(() => {
    if (activeIdx < 0) return;
    if (suppressScrollRef.current) {
      suppressScrollRef.current = false;
      return;
    }
    const el = blocksRef.current?.querySelector(`[data-index="${activeIdx}"]`);
    if (!el) return;
    const sc = scrollRef.current;
    const er = el.getBoundingClientRect();
    const sr = sc.getBoundingClientRect();
    const out = er.left < sr.left || er.right > sr.right;
    if (out) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeIdx]);

  return (
    <div className="timeline">
      <div className="tl-controls">
        <span className="tl-label">時間軸</span>
        <div className="tl-zoom">
          <button className="icon-btn" title="縮小" onClick={() => zoomBy(0.5)}>－</button>
          <span className="tl-px">{pxPerSec}px/s</span>
          <button className="icon-btn" title="放大" onClick={() => zoomBy(2)}>＋</button>
        </div>
        <span className="tl-time">{fmtTime(currentTime)} / {fmtTime(duration)}</span>
        <span className="tl-hint">拖曳字幕塊左右邊緣調整時間</span>
      </div>
      <div
        className="tl-scroll"
        ref={scrollRef}
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
      >
        <div className="tl-content" style={{ width: contentWidth }}>
          <div className="tl-ruler">
            {Array.from({ length: Math.floor(duration) + 1 }, (_, s) => (
              <span
                key={s}
                className="tl-tick"
                style={{ left: s * pxPerSec }}
                title={fmtTime(s)}
              />
            ))}
          </div>
          <canvas
            ref={canvasRef}
            className="tl-wave"
            onClick={seekFromEvent}
            style={{ width: contentWidth, height: 64 }}
          />
          <div className="tl-blocks" ref={blocksRef} style={{ height: 46 }}>
            {segments.map((s, i) => (
              <div
                key={i}
                data-index={i}
                className={`tl-block ${i === activeIdx ? 'active' : ''}`}
                style={{ left: s.start * pxPerSec, width: Math.max((s.end - s.start) * pxPerSec, 14) }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => blockPointerDown(e, i)}
                title={`${fmtTime(s.start)} → ${fmtTime(s.end)}\n${s.text}\n拖曳左右邊緣調整時間`}
              >
                <span className="tl-block-handle left" />
                <span className="tl-block-text">{s.text}</span>
                <span className="tl-block-handle right" />
              </div>
            ))}
          </div>
          <div className="tl-playhead" ref={playheadRef} style={{ left: currentTime * pxPerSec }} />
        </div>
      </div>
    </div>
  );
}