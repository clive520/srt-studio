import { useCallback, useRef, useState } from 'react';

/**
 * 帶復原/重做的狀態管理。
 * - commit(nextOrUpdater)：正常修改，自動把變更前狀態推進復原堆疊
 * - setState：原始修改（不進歷史），配合 snapshot() 使用
 * - snapshot()：在連續原始修改（如拖曳）前呼叫一次，作為單一復原步驟
 */
export function useHistory(initial) {
  const [state, setState] = useState(initial);
  const stateRef = useRef(initial);
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  stateRef.current = state;

  const pushHistory = useCallback((prev) => {
    undoStack.current.push(prev);
    if (undoStack.current.length > 200) undoStack.current.shift();
    redoStack.current = [];
  }, []);

  const commit = useCallback(
    (next) => {
      setState((prev) => {
        pushHistory(prev);
        return typeof next === 'function' ? next(prev) : next;
      });
    },
    [pushHistory]
  );

  const snapshot = useCallback(() => {
    pushHistory(stateRef.current);
  }, [pushHistory]);

  const undo = useCallback(() => {
    setState((prev) => {
      const prevState = undoStack.current.pop();
      if (prevState === undefined) return prev;
      redoStack.current.push(prev);
      return prevState;
    });
  }, []);

  const redo = useCallback(() => {
    setState((prev) => {
      const next = redoStack.current.pop();
      if (next === undefined) return prev;
      undoStack.current.push(prev);
      return next;
    });
  }, []);

  const canUndo = useCallback(() => undoStack.current.length > 0, []);
  const canRedo = useCallback(() => redoStack.current.length > 0, []);

  return { state, setState, commit, snapshot, undo, redo, canUndo, canRedo };
}