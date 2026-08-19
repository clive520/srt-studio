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
  const [peaks, setPeaks] = useState(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const dragRef = useRef(null);

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

    const startX = Math.max(0, Math.floor(scrollLeft));
    const endX = Math.min(Math.ceil(scrollLeft + w), Math.ceil(contentWidth));
    ctx.fillStyle = 'rgba(139, 147, 167, 0.75)';
    const mid = h / 2;
    for (let x = startX; x < endX; x++) {
      const idx = Math.min(peaks.count - 1, Math.floor((x / contentWidth) * peaks.count));
      const y0 = mid - Math.min(1, Math.max(-1, peaks.max[idx])) * (h / 2);
      const y1 = mid - Math.min(1, Math.max(-1, peaks.min[idx])) * (h / 2);
      ctx.fillRect(x - scrollLeft, y0, 1, Math.max(1, y1 - y0));
    }

    // 播放頭
    const px = currentTime * pxPerSec - scrollLeft;
    if (px >= -1 && px <= w + 1) {
      ctx.fillStyle = '#ff5d6c';
      ctx.fillRect(px, 0, 2, h);
    }
  }, [peaks, pxPerSec, currentTime, scrollLeft, contentWidth]);

  const seekFromEvent = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft;
    onSeek(Math.max(0, Math.min(x / pxPerSec, duration)));
  };

  const blockPointerDown = (e, i) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const mode = offX < 8 ? 'start' : offX > rect.width - 8 ? 'end' : 'select';
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

  // 選中段自動捲入可見範圍
  useEffect(() => {
    if (activeIdx < 0) return;
    const el = blocksRef.current?.querySelector(`[data-index="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
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
                title={`${fmtTime(s.start)} → ${fmtTime(s.end)}\n${s.text}`}
              >
                <span>{s.text}</span>
              </div>
            ))}
          </div>
          <div className="tl-playhead" style={{ left: currentTime * pxPerSec }} />
        </div>
      </div>
    </div>
  );
}