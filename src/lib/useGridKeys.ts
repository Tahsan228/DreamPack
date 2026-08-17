import { useEffect, useRef } from 'react';

export interface GridKeyHandlers {
  /** Move the cursor by whole cells; the grid decides what a row is worth. */
  move: (delta: number) => void;
  moveToEdge: (edge: 'start' | 'end') => void;
  /** Pick the nth candidate of the selected slot, 1-based. */
  pickNth: (n: number) => void;
  clearPick: () => void;
  openEditor: () => void;
  focusSearch: () => void;
  deselect: () => void;
  undo: () => void;
  redo: () => void;
}

/** True when the keystroke belongs to whatever the user is typing in. */
function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  // The custom dropdown runs its own arrow-key handling.
  return Boolean(el.closest('.mc-select-root'));
}

/**
 * Keyboard control for the slot grid.
 *
 * Mixing a pack means visiting hundreds of slots, which is a lot of mousing.
 * The selection is already the cursor - it drives the viewport - so the keys
 * just move it, and the number keys pick from the candidate strip the user is
 * looking at.
 *
 * Listening on the window rather than the grid means the keys work straight
 * after a click anywhere in it, at the cost of having to stand aside for text
 * fields, the texture editor (which binds its own undo) and open dialogs.
 */
export function useGridKeys(handlers: GridKeyHandlers, enabled: boolean, columns: number) {
  // Held in a ref so the listener is installed once rather than on every
  // keystroke-driven re-render.
  const ref = useRef(handlers);
  ref.current = handlers;

  const colsRef = useRef(columns);
  colsRef.current = columns;

  useEffect(() => {
    if (!enabled) return;

    const onKey = (e: KeyboardEvent) => {
      const h = ref.current;
      const cols = Math.max(1, colsRef.current);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) h.redo();
        else h.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        h.redo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // "/" opens search, so it has to be handled before the typing guard;
      // everything after it belongs to the grid only.
      if (e.key === '/' && !isTyping()) {
        e.preventDefault();
        h.focusSearch();
        return;
      }
      if (isTyping()) return;

      switch (e.key) {
        case 'ArrowLeft': e.preventDefault(); h.move(-1); return;
        case 'ArrowRight': e.preventDefault(); h.move(1); return;
        case 'ArrowUp': e.preventDefault(); h.move(-cols); return;
        case 'ArrowDown': e.preventDefault(); h.move(cols); return;
        case 'PageUp': e.preventDefault(); h.move(-cols * 5); return;
        case 'PageDown': e.preventDefault(); h.move(cols * 5); return;
        case 'Home': e.preventDefault(); h.moveToEdge('start'); return;
        case 'End': e.preventDefault(); h.moveToEdge('end'); return;
        case 'Enter': e.preventDefault(); h.openEditor(); return;
        case 'Escape': e.preventDefault(); h.deselect(); return;
        case 'Backspace':
        case 'Delete':
        case '0':
          e.preventDefault();
          h.clearPick();
          return;
        default: break;
      }

      if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        h.pickNth(Number(e.key));
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
