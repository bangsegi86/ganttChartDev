import { useEffect } from 'react';
import { useProjectStore } from '@/app/store/useProjectStore';

/**
 * Global keyboard shortcuts. Skips events originating from text inputs so
 * typing in the grid/dialogs is never hijacked.
 *
 *   Ctrl/Cmd+Z / Ctrl+Y  Undo / Redo
 *   Ctrl/Cmd+C / V       Copy / Paste — handled by DataGrid onCopy/onPaste
 *                         events (native clipboard, supports Excel paste)
 *   Ctrl/Cmd+D           Duplicate
 *   Ctrl/Cmd+S           Save
 *   Delete / Backspace   Delete selected
 *   Tab / Shift+Tab      Indent / Outdent (handled in grid)
 *   +/-                  Zoom in / out (preset levels)
 *   Alt+↑ / Alt+↓       Move selected task up / down within siblings
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isText =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      const store = useProjectStore.getState();
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        store.undo();
        return;
      }
      if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        store.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void store.saveProject();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        store.duplicateSelected();
        return;
      }

      if (isText) return; // remaining shortcuts must not fire while editing text

      // Ctrl+C / Ctrl+V: let the browser fire the native copy/paste events which
      // are handled by DataGrid's onCopy / onPaste (supports both app-to-app TSV
      // and external sources like Excel). Do NOT intercept here to avoid double
      // paste and to ensure the system clipboard is always the source of truth.

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (store.selectedTaskIds.size > 0) {
          e.preventDefault();
          store.deleteSelected();
        }
        return;
      }
      if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault();
        for (const id of store.selectedTaskIds) store.moveTaskUp(id);
        return;
      }
      if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        for (const id of store.selectedTaskIds) store.moveTaskDown(id);
        return;
      }
      if (e.key === '+' || e.key === '=') {
        store.zoomBy(1);
        return;
      }
      if (e.key === '-' || e.key === '_') {
        store.zoomBy(-1);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
