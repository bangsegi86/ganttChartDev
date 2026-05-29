import { useEffect } from 'react';
import { useProjectStore } from '@/app/store/useProjectStore';

/**
 * Global keyboard shortcuts. Skips events originating from text inputs so
 * typing in the grid/dialogs is never hijacked.
 *
 *   Ctrl/Cmd+Z / Ctrl+Y  Undo / Redo
 *   Ctrl/Cmd+C / V       Copy / Paste tasks
 *   Ctrl/Cmd+D           Duplicate
 *   Ctrl/Cmd+S           Save
 *   Delete / Backspace   Delete selected
 *   Tab / Shift+Tab      Indent / Outdent (handled in grid)
 *   +/-                  Zoom in / out
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

      if (mod && e.key.toLowerCase() === 'c') {
        store.copySelected();
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        store.paste();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (store.selectedTaskIds.size > 0) {
          e.preventDefault();
          store.deleteSelected();
        }
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
