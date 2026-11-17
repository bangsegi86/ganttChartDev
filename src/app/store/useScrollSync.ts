import { create } from 'zustand';

/**
 * Shared vertical scroll offset for the grid and gantt panes.
 *
 * Kept in its own tiny store (not App state) so scrolling re-renders only the
 * two panes that subscribe, not the whole application shell and toolbar.
 */
interface ScrollSyncState {
  scrollTop: number;
  setScrollTop: (top: number) => void;
}

export const useScrollSync = create<ScrollSyncState>((set) => ({
  scrollTop: 0,
  setScrollTop: (top) => set({ scrollTop: top }),
}));
