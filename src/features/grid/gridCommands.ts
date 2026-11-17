/**
 * Lets toolbar buttons run the grid's own keyboard commands (paste, cut, …)
 * so a button and its shortcut always behave identically. The DataGrid
 * registers `run` while mounted.
 */
export const gridCommands: {
  /** Run the grid shortcut Ctrl/Cmd+`key` (with Shift when `shift`). */
  run?: (key: 'v' | 'x' | 'c', shift?: boolean) => void;
} = {};

import { create } from 'zustand';

/** Rows marked by Cut (Ctrl+X), waiting to be moved by the next paste. */
export const useCutStore = create<{ ids: Set<string>; setIds: (ids: Set<string>) => void }>((set) => ({
  ids: new Set(),
  setIds: (ids) => set({ ids }),
}));
