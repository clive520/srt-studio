import { useRef } from 'react';
import { fmtTime } from './srt.js';

/**
 * 編輯面板：選中段放大顯示，並同時呈現前二段與後二段做為上下文，
 * 方便判斷切割/合併的位置。
 */
export default function EditPanel({
  segments,
  activeIdx,
  onSelect,
  onSeek,
  onUpdate,
  onDelete,
  onMove,
  onMerge,
  onSplit,
  onPlay,
}) {
  const textRef = useRef(null);
  const caretRef = useRef(null);
  const s = activeIdx >= 0 ? segments[activeIdx] : null;
  const ctxPrev = activeIdx > 0 ? segments.slice(Math.max(0, activeIdx - 2), activeIdx).reverse() : [];
  const ctxNext = segments.slice(activeIdx + 1, activeIdx + 3);

  const trackCaret = () => {
    const el = textRef.current;
    if (el) caretRef.current = el.selectionStart;
  };

  if (!s) {
    return (
      <div className="edit-panel empty-panel">
        點選時間軸上的字幕塊，或按 <kbd>↑</kbd><kbd>↓</kbd> 選擇來編輯
      </div>
    );
  }

  const handleSplit = () => {
    const el = textRef.current;
    // selectionStart 隨時代表目前游標位置（即使失焦也保留），
    // 所以直接讀取，不需檢查焦點（點按鈕會讓 textarea 失焦）
    const caret = el ? el.selectionStart : caretRef.current ?? Math.floor(s.text.length / 2);
    onSplit(activeIdx, caret);
  };

  const contextRow = (seg, label) => (
    <div
      className="ctx-row"
      onClick={() => onSelect(segments.indexOf(seg))}
      title="點擊切換到這一段"
    >
      <span className="ctx-time">
        {fmtTime(seg.start)} → {fmtTime(seg.end)}
      </span>
      <span className="ctx-text">{seg.text}</span>
      {label === '前1' && <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onMerge(activeIdx, -1); }} title="合併到這一段">⇐ 合併</button>}
      {label === '後1' && <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onMerge(activeIdx, 1); }} title="與這一段合併">合併 ⇒</button>}
    </div>
  );

  return (
    <div className="edit-panel">
      {ctxPrev.map((seg, i) => (
        <div key={seg.start + seg.text}>
          <div className="ctx-label">{i === 0 ? '前1' : '前2'}</div>
          {contextRow(seg, i === 0 ? '前1' : '')}
        </div>
      ))}

      <div className="main-edit">
        <div className="main-edit-time">
          <label>起
            <input
              type="number"
              min="0"
              step="0.1"
              value={Math.round(s.start * 100) / 100}
              onChange={(e) => onUpdate(activeIdx, { start: +e.target.value || 0 })}
            />
          </label>
          <label>止
            <input
              type="number"
              min="0"
              step="0.1"
              value={Math.round(s.end * 100) / 100}
              onChange={(e) => onUpdate(activeIdx, { end: +e.target.value || 0 })}
            />
          </label>
          <button className="btn small" onClick={() => onPlay(activeIdx)}>▶ 播放此段</button>
          <button className="btn small" onClick={() => onSeek(s.start)}>◉ 跳到開頭</button>
        </div>
        <textarea
          ref={textRef}
          rows="3"
          value={s.text}
          onChange={(e) => onUpdate(activeIdx, { text: e.target.value })}
          onFocus={trackCaret}
          onSelect={trackCaret}
          onMouseUp={trackCaret}
          onKeyUp={trackCaret}
          placeholder="在此修改字幕文字…"
        />
        <div className="main-edit-actions">
          <button className="btn small" onClick={() => onMerge(activeIdx, -1)} disabled={activeIdx === 0}>
            ⇐ 合併上一段
          </button>
          <button className="btn small" onClick={() => onMerge(activeIdx, 1)} disabled={activeIdx >= segments.length - 1}>
            合併下一段 ⇒
          </button>
          <button className="btn small" onClick={handleSplit} title="把游標放在想切斷的位置，再按這裡（或按 S）">
            ✂ 在游標處切分
          </button>
          <button className="btn small" onClick={() => onMove(activeIdx, -1)} disabled={activeIdx === 0}>↑ 上移</button>
          <button className="btn small" onClick={() => onMove(activeIdx, 1)} disabled={activeIdx >= segments.length - 1}>↓ 下移</button>
          <button className="btn small danger" onClick={() => onDelete(activeIdx)}>✕ 刪除</button>
        </div>
        <p className="split-hint">切分：先在文字框把游標移到想切的位置，再按「在游標處切分」或鍵盤 <kbd>S</kbd></p>
      </div>

      {ctxNext.map((seg, i) => (
        <div key={seg.start + seg.text}>
          <div className="ctx-label">{i === 0 ? '後1' : '後2'}</div>
          {contextRow(seg, i === 0 ? '後1' : '')}
        </div>
      ))}
    </div>
  );
}