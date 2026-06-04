import { createPortal } from 'react-dom';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronsDown, ChevronsUp, Diamond, GripVertical, Lock } from 'lucide-react';
import { useProjectStore } from '@/app/store/useProjectStore';
import { buildVisibleRows, type VisibleRow } from './treeModel';
import { useVisibleTasks } from '@/features/view/viewFilter';
import { HEADER_HEIGHT, ROW_HEIGHT, SCROLL_BOTTOM_PADDING } from '@/features/gantt/layout';
import { cn } from '@/shared/ui/cn';
import type { Priority, Task } from '@/entities';
import { GridCell } from './GridCell';
import { readClipboardText, writeClipboardText } from '@/shared/clipboard';

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

interface ColumnDef {
  key: string;
  label: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

const DEFAULT_COLUMNS: ColumnDef[] = [
  { key: 'wbs',      label: 'WBS',    width: 56,  align: 'right' },
  { key: 'name',     label: '작업명', width: 220 },
  { key: 'start',    label: '시작',   width: 104 },
  { key: 'end',      label: '종료',   width: 104 },
  { key: 'duration', label: '기간',   width: 56,  align: 'right' },
  { key: 'assignee', label: '담당자', width: 110 },
  { key: 'progress', label: '진척',   width: 64,  align: 'right' },
  { key: 'priority', label: '우선순위', width: 84 },
];

const PRIORITY_LABELS: Record<Priority, string> = {
  low: '낮음', medium: '보통', high: '높음', critical: '긴급',
};

// ---------------------------------------------------------------------------
// Constants & helpers (outside component — no re-creation on every render)
// ---------------------------------------------------------------------------

const PRIORITY_KO: Record<string, string> = {
  low: '낮음', medium: '보통', high: '높음', critical: '긴급',
};
const PRIORITY_FROM_KO: Record<string, string> = {
  '낮음': 'low', '보통': 'medium', '높음': 'high', '긴급': 'critical',
};
const EDITABLE_COLS = new Set(['name', 'start', 'end', 'progress']);

type CellPos = { taskId: string; colKey: string };

export interface EditRequest {
  taskId: string;
  colKey: string;
  initial: string | null;
}

/** Read a cell value as a plain string (for copy). */
function getCellText(task: Task, colKey: string): string {
  switch (colKey) {
    case 'name':     return task.name;
    case 'start':    return task.start;
    case 'end':      return task.end;
    case 'progress': return String(task.progress);
    case 'priority': return PRIORITY_KO[task.priority] ?? task.priority;
    case 'duration': return String(task.durationDays);
    default:         return '';
  }
}

/** Normalise date input: accepts YYYY-MM-DD and YYYYMMDD. Returns null if invalid. */
function normalizeDate(v: string): string | null {
  const s = v.trim().replace(/\//g, '-');
  const n = /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
  return /^\d{4}-\d{2}-\d{2}$/.test(n) ? n : null;
}

/** Convert a pasted string value into a Task patch for a given column. Returns null if invalid/read-only. */
function parseCellPatch(colKey: string, raw: string): Partial<Task> | null {
  const v = raw.trim();
  if (!v) return null;
  switch (colKey) {
    case 'name': return { name: v.slice(0, 200) };
    case 'start': { const d = normalizeDate(v); return d ? { start: d } : null; }
    case 'end':   { const d = normalizeDate(v); return d ? { end: d } : null; }
    case 'progress': {
      const n = Math.max(0, Math.min(100, parseInt(v, 10) || 0));
      return { progress: n };
    }
    case 'priority': {
      const p = PRIORITY_FROM_KO[v] ?? (['low', 'medium', 'high', 'critical'].includes(v) ? v : null);
      return p ? { priority: p as Priority } : null;
    }
    default: return null;
  }
}

/** Split clipboard text into a 2-D array. Normalises CR/LF. */
function parseTsvGrid(text: string): string[][] {
  return text
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => l.split('\t'));
}

// ---------------------------------------------------------------------------
// DataGrid
// ---------------------------------------------------------------------------

interface DataGridProps {
  width: number;
  scrollTop: number;
  onScrollTopChange: (top: number) => void;
}

/**
 * Left-hand WBS grid. Virtualised rows kept aligned with the gantt via a shared
 * scrollTop. Excel-like editing: arrow-key navigation, type-to-edit, F2, range
 * selection (Shift+Arrow / Shift+Click), range copy/paste.
 */
export function DataGrid({ width, scrollTop, onScrollTopChange }: DataGridProps) {
  // --- store ---
  const schedules          = useProjectStore((s) => s.derived.schedules);
  const selected           = useProjectStore((s) => s.selectedTaskIds);
  const showCritical       = useProjectStore((s) => s.view.showCriticalPath);
  const selectTask         = useProjectStore((s) => s.selectTask);
  const setSelectedTaskIds = useProjectStore((s) => s.setSelectedTaskIds);
  const toggleCollapse     = useProjectStore((s) => s.toggleCollapse);
  const expandAll          = useProjectStore((s) => s.expandAll);
  const collapseAll        = useProjectStore((s) => s.collapseAll);
  const indentTask         = useProjectStore((s) => s.indentTask);
  const outdentTask        = useProjectStore((s) => s.outdentTask);
  const importTsvTasks     = useProjectStore((s) => s.importTsvTasks);
  const insertTsvTasks     = useProjectStore((s) => s.insertTsvTasks);
  const updateTasksFromTsv = useProjectStore((s) => s.updateTasksFromTsv);
  const batchUpdateTasks   = useProjectStore((s) => s.batchUpdateTasks);
  const moveTaskBefore     = useProjectStore((s) => s.moveTaskBefore);
  const sortChildrenByStart = useProjectStore((s) => s.sortChildrenByStart);
  const scrollGanttToDate  = useProjectStore((s) => s.scrollGanttToDate);
  const addTasksToGroup    = useProjectStore((s) => s.addTasksToGroup);
  const removeTasksFromGroup = useProjectStore((s) => s.removeTasksFromGroup);
  const viewGroups         = useProjectStore((s) => s.derived.project.viewGroups);

  // --- state ---
  const [columns, setColumns]       = useState(DEFAULT_COLUMNS);
  const [filter, setFilter]         = useState('');
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [contextMenu, setContextMenu]   = useState<{ x: number; y: number; taskId: string } | null>(null);
  /** Active cell (moving end of the selection range). */
  const [selectedCell, setSelectedCell] = useState<CellPos | null>(null);
  /** Fixed anchor of the range (Shift+click/Shift+Arrow keeps this while moving active cell). */
  const [rangeAnchor, setRangeAnchor]   = useState<CellPos | null>(null);
  /** Keyboard-driven edit request (type-to-edit / F2). */
  const [editRequest, setEditRequest]   = useState<EditRequest | null>(null);

  // --- refs ---
  const containerRef         = useRef<HTMLDivElement>(null);
  const scrollerRef          = useRef<HTMLDivElement>(null);
  const isSyncingRef         = useRef(false);
  const isUserScrollingRef   = useRef(false);
  const clearUserScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Row anchor for Shift+click ROW selection (separate from cell range anchor). */
  const anchorIdRef          = useRef<string | null>(null);
  const dragIdRef            = useRef<string | null>(null);
  /** True when the last mousedown was inside the DataGrid container. */
  const gridActiveRef        = useRef(false);

  // Snapshot refs so the window keydown closure never goes stale.
  const rowsRef              = useRef<VisibleRow[]>([]);
  const selectedRef          = useRef(selected);
  const selectedCellRef      = useRef(selectedCell);
  const rangeAnchorRef       = useRef(rangeAnchor);
  const columnsRef           = useRef(columns);
  const importTsvTasksRef    = useRef(importTsvTasks);
  const insertTsvTasksRef    = useRef(insertTsvTasks);
  const updateTasksFromTsvRef = useRef(updateTasksFromTsv);
  const batchUpdateTasksRef  = useRef(batchUpdateTasks);

  // --- derived rows ---
  const visibleTasks = useVisibleTasks();
  const allRows = useMemo(() => buildVisibleRows(visibleTasks), [visibleTasks]);
  const hasParents  = useMemo(() => allRows.some((r) => r.hasChildren), [allRows]);
  const rows = useMemo(() => {
    if (!filter.trim()) return allRows;
    const q = filter.trim().toLowerCase();
    return allRows.filter((r) => r.task.name.toLowerCase().includes(q));
  }, [allRows, filter]);

  // --- ref sync effects ---
  useEffect(() => { rowsRef.current = rows; },                       [rows]);
  useEffect(() => { selectedRef.current = selected; },               [selected]);
  useEffect(() => { selectedCellRef.current = selectedCell; },       [selectedCell]);
  useEffect(() => { rangeAnchorRef.current = rangeAnchor; },         [rangeAnchor]);
  useEffect(() => { columnsRef.current = columns; },                 [columns]);
  useEffect(() => { importTsvTasksRef.current = importTsvTasks; },   [importTsvTasks]);
  useEffect(() => { insertTsvTasksRef.current = insertTsvTasks; },   [insertTsvTasks]);
  useEffect(() => { updateTasksFromTsvRef.current = updateTasksFromTsv; }, [updateTasksFromTsv]);
  useEffect(() => { batchUpdateTasksRef.current = batchUpdateTasks; }, [batchUpdateTasks]);

  // --- scroll sync (gantt → grid) ---
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || Math.abs(el.scrollTop - scrollTop) <= 0.5) return;
    if (isUserScrollingRef.current) return;
    isSyncingRef.current = true;
    el.scrollTop = scrollTop;
    requestAnimationFrame(() => { isSyncingRef.current = false; });
  }, [scrollTop]);

  // --- close context menu on outside click ---
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [contextMenu]);

  // --- auto-scroll active cell into view ---
  useEffect(() => {
    if (!selectedCell) return;
    const idx = rows.findIndex((r) => r.task.id === selectedCell.taskId);
    if (idx < 0) return;
    const el = scrollerRef.current;
    if (!el) return;
    const top    = idx * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < el.scrollTop) {
      el.scrollTop = top;
      onScrollTopChange(top);
    } else if (bottom > el.scrollTop + el.clientHeight) {
      const next = bottom - el.clientHeight;
      el.scrollTop = next;
      onScrollTopChange(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCell]);

  // --- track last-clicked area (more reliable than activeElement for key routing) ---
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      gridActiveRef.current = Boolean(containerRef.current?.contains(e.target as Node));
    };
    window.addEventListener('mousedown', onMouseDown, true);
    return () => window.removeEventListener('mousedown', onMouseDown, true);
  }, []);

  // --- viewport virtualization ---
  const viewportH = scrollerRef.current?.clientHeight ?? 800;
  const first     = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 4);
  const last      = Math.min(rows.length, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + 4);
  const visible   = rows.slice(first, last);
  const totalWidth = columns.reduce((s, c) => s + c.width, 0);

  // --- range highlight computation ---
  const rangeInfo = useMemo(() => {
    if (!selectedCell || !rangeAnchor) return null;
    const ar = rows.findIndex((r) => r.task.id === rangeAnchor.taskId);
    const sr = rows.findIndex((r) => r.task.id === selectedCell.taskId);
    const ac = columns.findIndex((c) => c.key === rangeAnchor.colKey);
    const sc = columns.findIndex((c) => c.key === selectedCell.colKey);
    if (ar === -1 || sr === -1 || ac === -1 || sc === -1) return null;
    const minRow = Math.min(ar, sr), maxRow = Math.max(ar, sr);
    const minCol = Math.min(ac, sc), maxCol = Math.max(ac, sc);
    return {
      minRow, maxRow,
      colKeys: new Set(columns.slice(minCol, maxCol + 1).map((c) => c.key)),
    };
  }, [selectedCell, rangeAnchor, rows, columns]);

  // --- column resize ---
  const startColumnResize = (key: string, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = columns.find((c) => c.key === key)!.width;
    const move = (ev: MouseEvent) => {
      const w = Math.max(40, startW + (ev.clientX - startX));
      setColumns((cols) => cols.map((c) => (c.key === key ? { ...c, width: w } : c)));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // --- stable per-row callbacks (referentially constant so GridRow's React.memo
  //     can skip re-rendering unchanged rows while scrolling) ---

  // move active cell down after Enter-commit
  const moveActiveCellDown = useCallback(() => {
    const cur = selectedCellRef.current;
    if (!cur) return;
    const curRows = rowsRef.current;
    const r = curRows.findIndex((x) => x.task.id === cur.taskId);
    if (r < 0 || r >= curRows.length - 1) return;
    const next = curRows[r + 1];
    if (!next) return;
    const newCell: CellPos = { taskId: next.task.id, colKey: cur.colKey };
    setSelectedCell(newCell);
    setRangeAnchor(newCell);
  }, []);

  const handleEditConsumed = useCallback(() => setEditRequest(null), []);

  const handleCellSelect = useCallback((taskId: string, colKey: string, isShift: boolean) => {
    const newCell: CellPos = { taskId, colKey };
    setSelectedCell(newCell);
    if (!isShift || !rangeAnchorRef.current) setRangeAnchor(newCell);
    // Shift+click: keep existing anchor → range extends to this cell
  }, []);

  const handleRowSelect = useCallback((taskId: string, isCtrl: boolean, isShift: boolean) => {
    const curRows = rowsRef.current;
    if (isShift && anchorIdRef.current) {
      const anchorIdx  = curRows.findIndex((r) => r.task.id === anchorIdRef.current);
      const currentIdx = curRows.findIndex((r) => r.task.id === taskId);
      if (anchorIdx !== -1 && currentIdx !== -1) {
        const lo = Math.min(anchorIdx, currentIdx);
        const hi = Math.max(anchorIdx, currentIdx);
        setSelectedTaskIds(new Set(curRows.slice(lo, hi + 1).map((r) => r.task.id)));
        return;
      }
    }
    anchorIdRef.current = taskId;
    selectTask(taskId, isCtrl);
  }, [setSelectedTaskIds, selectTask]);

  const handleToggle  = useCallback((taskId: string) => toggleCollapse(taskId), [toggleCollapse]);
  const handleIndent  = useCallback((taskId: string) => indentTask(taskId),     [indentTask]);
  const handleOutdent = useCallback((taskId: string) => outdentTask(taskId),     [outdentTask]);

  const handleDragStart = useCallback((taskId: string) => { dragIdRef.current = taskId; }, []);
  const handleDragEnd   = useCallback(() => { dragIdRef.current = null; setDropTargetId(null); }, []);
  const handleDragOver  = useCallback((taskId: string) => setDropTargetId(taskId), []);
  const handleDrop      = useCallback((taskId: string) => {
    if (dragIdRef.current && taskId) moveTaskBefore(dragIdRef.current, taskId);
    dragIdRef.current = null;
    setDropTargetId(null);
  }, [moveTaskBefore]);

  const handleContextMenu = useCallback((e: React.MouseEvent, taskId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, taskId });
  }, []);

  // --- keyboard handler (capture phase, window-level) ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!gridActiveRef.current) return;

      const target = e.target as HTMLElement;
      const isTextInput =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      const mod  = e.ctrlKey || e.metaKey;
      const cell = selectedCellRef.current;

      // -----------------------------------------------------------------------
      // Non-modifier keys while NOT editing
      // -----------------------------------------------------------------------
      if (!mod && !isTextInput) {
        if (e.altKey) return; // pass Alt+key to global shortcuts

        // Escape: clear selection range
        if (e.key === 'Escape') {
          if (cell) {
            e.preventDefault();
            setSelectedCell(null);
            setRangeAnchor(null);
          }
          return;
        }

        if (!cell) return; // nothing selected — let event propagate

        const editable = EDITABLE_COLS.has(cell.colKey);

        // F2: edit existing value (cursor at end)
        if (e.key === 'F2' && editable) {
          e.preventDefault();
          setEditRequest({ taskId: cell.taskId, colKey: cell.colKey, initial: null });
          return;
        }

        // Printable char: overwrite edit. stopImmediatePropagation blocks
        // global shortcuts (e.g. +/- zoom) since we registered in capture phase.
        if (e.key.length === 1 && editable) {
          e.preventDefault();
          e.stopImmediatePropagation();
          setEditRequest({ taskId: cell.taskId, colKey: cell.colKey, initial: e.key });
          return;
        }

        // Arrow keys / Enter: navigation (Shift extends range, plain resets it)
        const isNav = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key);
        if (isNav) {
          const curRows = rowsRef.current;
          const cols    = columnsRef.current;
          let r = curRows.findIndex((x) => x.task.id === cell.taskId);
          let c = cols.findIndex((x) => x.key === cell.colKey);
          if (r === -1 || c === -1) return;

          switch (e.key) {
            case 'ArrowUp':    r = Math.max(0, r - 1); break;
            case 'ArrowDown':
            case 'Enter':      r = Math.min(curRows.length - 1, r + 1); break;
            case 'ArrowLeft':  c = Math.max(0, c - 1); break;
            case 'ArrowRight': c = Math.min(cols.length - 1, c + 1); break;
          }
          e.preventDefault();
          const nextRow = curRows[r];
          const nextCol = cols[c];
          if (!nextRow || !nextCol) return;
          const newCell: CellPos = { taskId: nextRow.task.id, colKey: nextCol.key };
          setSelectedCell(newCell);

          const store = useProjectStore.getState();
          if (!e.shiftKey) {
            // Plain nav: move cell + sync row highlight
            setRangeAnchor(newCell);
            anchorIdRef.current = nextRow.task.id;
            store.selectTask(nextRow.task.id, false);
          } else {
            // Shift+Arrow: extend cell range (keep anchor) + extend row selection
            if (anchorIdRef.current) {
              const anchorRowIdx = curRows.findIndex((x) => x.task.id === anchorIdRef.current);
              if (anchorRowIdx !== -1) {
                const lo = Math.min(anchorRowIdx, r);
                const hi = Math.max(anchorRowIdx, r);
                store.setSelectedTaskIds(new Set(curRows.slice(lo, hi + 1).map((x) => x.task.id)));
              }
            }
          }
        }
        return;
      }

      // -----------------------------------------------------------------------
      // Ctrl/Cmd shortcuts
      // -----------------------------------------------------------------------
      if (!mod || isTextInput) return;

      const key = e.key.toLowerCase();

      if (key === 'c') {
        e.preventDefault();
        const curRows  = rowsRef.current;
        const curCols  = columnsRef.current;
        const anchor   = rangeAnchorRef.current;
        const curSel   = selectedRef.current;

        if (cell && anchor) {
          // Range copy: rectangular selection → TSV (no header for grid-to-grid)
          const ar = curRows.findIndex((r) => r.task.id === anchor.taskId);
          const sr = curRows.findIndex((r) => r.task.id === cell.taskId);
          const ac = curCols.findIndex((c) => c.key === anchor.colKey);
          const sc = curCols.findIndex((c) => c.key === cell.colKey);
          if (ar === -1 || sr === -1 || ac === -1 || sc === -1) return;
          const minR = Math.min(ar, sr), maxR = Math.max(ar, sr);
          const minC = Math.min(ac, sc), maxC = Math.max(ac, sc);
          const rangeCols = curCols.slice(minC, maxC + 1);
          const tsv = curRows.slice(minR, maxR + 1)
            .map((row) => rangeCols.map((col) => getCellText(row.task, col.key)).join('\t'))
            .join('\n');
          void writeClipboardText(tsv);
          return;
        }

        // No cell selected: copy selected rows as TSV (with header for Excel)
        if (curSel.size === 0) return;
        const selRows = curRows.filter((r) => curSel.has(r.task.id));
        const header  = ['작업명', '시작', '종료', '기간(일)', '진척(%)', '우선순위'].join('\t');
        const lines   = selRows.map((r) => {
          const t = r.task;
          return [t.name, t.start, t.end, t.durationDays, t.progress,
            PRIORITY_KO[t.priority] ?? t.priority].join('\t');
        });
        void writeClipboardText([header, ...lines].join('\n'));
        return;
      }

      // Ctrl/Cmd+Shift+V: paste clipboard rows as NEW inserted tasks, after the
      // last selected row (or appended at the end when nothing is selected).
      if (key === 'v' && e.shiftKey) {
        e.preventDefault();
        void readClipboardText().then((text) => {
          if (!text.trim()) return;
          const curRows = rowsRef.current;
          const curSel  = selectedRef.current;
          let afterId: string | null = null;
          if (cell) {
            afterId = cell.taskId;
          } else if (curSel.size > 0) {
            // Insert after the last selected row in display order.
            const selRows = curRows.filter((r) => curSel.has(r.task.id));
            afterId = selRows.length ? selRows[selRows.length - 1]!.task.id : null;
          }
          insertTsvTasksRef.current(afterId, text);
        });
        return;
      }

      if (key === 'v') {
        e.preventDefault();
        void readClipboardText().then((text) => {
          const trimmed = text.trim();
          if (!trimmed) return;

          const isMultiValue = trimmed.includes('\t') || trimmed.includes('\n');
          const curRows = rowsRef.current;
          const curCols = columnsRef.current;

          // Single-value paste into active cell
          if (cell && !isMultiValue) {
            const patch = parseCellPatch(cell.colKey, trimmed);
            if (patch) batchUpdateTasksRef.current([{ id: cell.taskId, patch }]);
            return;
          }

          // Multi-value paste: fill from active cell position
          if (cell) {
            const startR = curRows.findIndex((r) => r.task.id === cell.taskId);
            const startC = curCols.findIndex((c) => c.key === cell.colKey);
            if (startR === -1 || startC === -1) return;

            const grid = parseTsvGrid(trimmed);
            const updates: { id: string; patch: Partial<Task> }[] = [];

            for (let dr = 0; dr < grid.length; dr++) {
              const rowIdx = startR + dr;
              if (rowIdx >= curRows.length) break; // don't auto-add rows during range paste
              const taskId = curRows[rowIdx]?.task.id;
              if (!taskId) break;
              const rowVals = grid[dr] ?? [];
              const merged: Partial<Task> = {};
              for (let dc = 0; dc < rowVals.length; dc++) {
                const colIdx = startC + dc;
                if (colIdx >= curCols.length) break;
                const col = curCols[colIdx];
                if (!col || !EDITABLE_COLS.has(col.key)) continue;
                const patch = parseCellPatch(col.key, rowVals[dc] ?? '');
                if (patch) Object.assign(merged, patch);
              }
              if (Object.keys(merged).length > 0) updates.push({ id: taskId, patch: merged });
            }
            if (updates.length > 0) batchUpdateTasksRef.current(updates);
            return;
          }

          // No cell selected → legacy row import / update
          const curSel   = selectedRef.current;
          const selIds   = curRows.filter((r) => curSel.has(r.task.id)).map((r) => r.task.id);
          if (selIds.length > 0) updateTasksFromTsvRef.current(selIds, trimmed);
          else importTsvTasksRef.current(trimmed);
        });
      }
    };

    // Capture phase ensures this runs before global shortcut listeners
    // (useKeyboardShortcuts) regardless of component mount order.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []); // empty deps — all mutable values accessed via refs

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-col border-r border-border bg-surface outline-none"
      style={{ width }}
    >
      {/* Filter + expand/collapse all */}
      <div className="flex items-center gap-1 border-b border-border px-2" style={{ height: 28 }}>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="작업 검색…"
          className="h-6 min-w-0 flex-1 rounded bg-surface-2 px-2 text-xs text-content outline-none placeholder:text-content-muted"
          aria-label="작업 검색"
        />
        <button
          onClick={expandAll}
          disabled={!hasParents}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-content-muted transition-colors hover:bg-surface-2 hover:text-content disabled:opacity-30"
          title="전체 펼치기"
          aria-label="전체 펼치기"
        >
          <ChevronsDown size={13} />
        </button>
        <button
          onClick={collapseAll}
          disabled={!hasParents}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-content-muted transition-colors hover:bg-surface-2 hover:text-content disabled:opacity-30"
          title="전체 접기"
          aria-label="전체 접기"
        >
          <ChevronsUp size={13} />
        </button>
      </div>

      {/* Column headers */}
      <div
        className="flex shrink-0 border-b border-border bg-surface-2 text-2xs font-semibold text-content-muted"
        style={{ height: HEADER_HEIGHT - 28, minWidth: totalWidth }}
      >
        {columns.map((col) => (
          <div
            key={col.key}
            className="relative flex items-center border-r border-border px-2"
            style={{ width: col.width, justifyContent: col.align === 'right' ? 'flex-end' : 'flex-start' }}
            role="columnheader"
          >
            <span className="truncate">{col.label}</span>
            <span
              className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-accent"
              onMouseDown={(e) => startColumnResize(col.key, e)}
              role="separator"
              aria-orientation="vertical"
            />
          </div>
        ))}
      </div>

      {/* Virtualised rows */}
      <div
        ref={scrollerRef}
        className="relative flex-1 overflow-x-scroll overflow-y-auto"
        onScroll={(e) => {
          if (isSyncingRef.current) return;
          isUserScrollingRef.current = true;
          if (clearUserScrollTimer.current) clearTimeout(clearUserScrollTimer.current);
          clearUserScrollTimer.current = setTimeout(() => { isUserScrollingRef.current = false; }, 150);
          onScrollTopChange(e.currentTarget.scrollTop);
        }}
        role="grid"
        aria-rowcount={rows.length}
      >
        <div style={{ height: rows.length * ROW_HEIGHT + SCROLL_BOTTOM_PADDING, minWidth: totalWidth, position: 'relative' }}>
          {visible.map((row, visIdx) => {
            const rowIdx      = first + visIdx;
            const inRange     = rangeInfo ? rowIdx >= rangeInfo.minRow && rowIdx <= rangeInfo.maxRow : false;
            const rangeColKeys = inRange ? rangeInfo!.colKeys : null;

            return (
              <GridRow
                key={row.task.id}
                row={row}
                columns={columns}
                top={rowIdx * ROW_HEIGHT}
                selected={selected.has(row.task.id)}
                critical={showCritical && (schedules.get(row.task.id)?.isCritical ?? false)}
                isDragOver={dropTargetId === row.task.id}
                selectedCellKey={selectedCell?.taskId === row.task.id ? selectedCell.colKey : null}
                rangeColKeys={rangeColKeys}
                editRequest={editRequest?.taskId === row.task.id ? editRequest : null}
                onEditConsumed={handleEditConsumed}
                onEditNavigate={moveActiveCellDown}
                onCellSelect={handleCellSelect}
                onSelect={handleRowSelect}
                onToggle={handleToggle}
                onIndent={handleIndent}
                onOutdent={handleOutdent}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onContextMenu={handleContextMenu}
              />
            );
          })}
        </div>
      </div>

      {/* Context menu (view group assignment) */}
      {contextMenu && createPortal(
        <div
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 9999 }}
          className="min-w-[160px] rounded-md border border-border bg-surface-2 py-1 shadow-xl text-xs"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Sort / scroll actions */}
          {(() => {
            const menuRow = rows.find((r) => r.task.id === contextMenu.taskId);
            return (
              <>
                <div className="px-3 py-1 text-2xs font-semibold uppercase tracking-wider text-content-muted">정렬 / 이동</div>
                <button
                  className="w-full px-3 py-1.5 text-left hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!menuRow?.hasChildren}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    sortChildrenByStart(contextMenu.taskId);
                    setContextMenu(null);
                  }}
                  title={menuRow?.hasChildren ? undefined : '하위 일정이 없습니다'}
                >
                  하위 일정 시작일 순 정렬
                </button>
                <button
                  className="w-full border-b border-border px-3 py-1.5 text-left hover:bg-surface-3"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    if (menuRow) scrollGanttToDate(menuRow.task.start);
                    setContextMenu(null);
                  }}
                >
                  차트에서 시작일로 이동
                </button>
              </>
            );
          })()}
          {/* Paste-as-new-rows actions */}
          <div className="px-3 py-1 text-2xs font-semibold uppercase tracking-wider text-content-muted">붙여넣기</div>
          <button
            className="w-full px-3 py-1.5 text-left hover:bg-surface-3"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              const id = contextMenu.taskId;
              setContextMenu(null);
              void readClipboardText().then((text) => {
                if (text.trim()) insertTsvTasksRef.current(id, text);
              });
            }}
          >
            이 행 아래 붙여넣기 <span className="text-content-muted">(행 삽입)</span>
          </button>
          <button
            className="w-full border-b border-border px-3 py-1.5 text-left hover:bg-surface-3"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              setContextMenu(null);
              void readClipboardText().then((text) => {
                if (text.trim()) insertTsvTasksRef.current(null, text);
              });
            }}
          >
            맨 아래에 붙여넣기
          </button>
          {viewGroups.length === 0 ? (
            <div className="px-3 py-2 text-content-muted">보기 그룹이 없습니다</div>
          ) : (
            <>
              <div className="px-3 py-1 text-2xs font-semibold uppercase tracking-wider text-content-muted">보기 그룹</div>
              {viewGroups.map((g) => {
                const inGroup = g.taskIds.includes(contextMenu.taskId);
                return (
                  <label
                    key={g.id}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-surface-3"
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={inGroup}
                      onChange={() => {
                        if (inGroup) removeTasksFromGroup(g.id, [contextMenu.taskId]);
                        else addTasksToGroup(g.id, [contextMenu.taskId]);
                      }}
                      className="h-3 w-3 accent-accent"
                    />
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: g.color }} />
                    {g.name}
                  </label>
                );
              })}
            </>
          )}
          <button
            className="mt-1 w-full border-t border-border px-3 py-1.5 text-left text-content-muted hover:bg-surface-3"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setContextMenu(null)}
          >
            닫기
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GridRow
// ---------------------------------------------------------------------------

interface GridRowProps {
  row: VisibleRow;
  columns: ColumnDef[];
  top: number;
  selected: boolean;
  critical: boolean;
  isDragOver: boolean;
  selectedCellKey: string | null;
  /** All column keys highlighted as part of the current range in this row. */
  rangeColKeys: Set<string> | null;
  editRequest: EditRequest | null;
  onEditConsumed: () => void;
  onEditNavigate: () => void;
  onSelect: (taskId: string, isCtrl: boolean, isShift: boolean) => void;
  onCellSelect: (taskId: string, colKey: string, isShift: boolean) => void;
  onToggle: (taskId: string) => void;
  onIndent: (taskId: string) => void;
  onOutdent: (taskId: string) => void;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
  onDragOver: (taskId: string) => void;
  onDrop: (taskId: string) => void;
  onContextMenu: (e: React.MouseEvent, taskId: string) => void;
}

const GridRow = memo(function GridRow({
  row,
  columns,
  top,
  selected,
  critical,
  isDragOver,
  selectedCellKey,
  rangeColKeys,
  editRequest,
  onEditConsumed,
  onEditNavigate,
  onSelect,
  onCellSelect,
  onToggle,
  onIndent,
  onOutdent,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onContextMenu,
}: GridRowProps) {
  const { task, depth, hasChildren, wbs } = row;
  const project    = useProjectStore((s) => s.derived.project);
  const taskGroups = project.viewGroups.filter((g) => g.taskIds.includes(task.id));

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) onOutdent(task.id); else onIndent(task.id);
    }
  };

  return (
    <div
      className={cn(
        'absolute left-0 flex w-full items-stretch border-b border-border text-xs group/row',
        task.cancelled && 'opacity-50',
        selected ? 'bg-accent/15' : hasChildren ? 'bg-surface-2/40' : 'hover:bg-surface-2/60',
        isDragOver && 'shadow-[0_-2px_0_0_rgb(var(--color-accent))]',
      )}
      style={{ top, height: ROW_HEIGHT }}
      draggable
      onMouseDown={(e) => onSelect(task.id, e.ctrlKey || e.metaKey, e.shiftKey)}
      onKeyDown={handleKeyDown}
      onDragStart={(e) => { e.stopPropagation(); onDragStart(task.id); }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => { e.preventDefault(); onDragOver(task.id); }}
      onDrop={(e) => { e.preventDefault(); onDrop(task.id); }}
      onContextMenu={(e) => onContextMenu(e, task.id)}
      tabIndex={0}
      role="row"
      aria-selected={selected}
    >
      <div className="pointer-events-none absolute left-0.5 top-0 z-[1] flex h-full items-center text-content-muted opacity-0 group-hover/row:opacity-40">
        <GripVertical size={11} />
      </div>

      {columns.map((col) => {
        const isActive  = selectedCellKey === col.key;
        const isInRange = !isActive && (rangeColKeys?.has(col.key) ?? false);
        return (
          <div
            key={col.key}
            onClick={(e) => { e.stopPropagation(); onCellSelect(task.id, col.key, e.shiftKey); }}
            className={cn(
              'flex items-center overflow-hidden border-r border-border px-2',
              col.align === 'right'  && 'justify-end',
              col.align === 'center' && 'justify-center',
              critical && col.key === 'name' && 'text-critical',
              isActive  && 'ring-2 ring-inset ring-accent',
              isInRange && 'bg-accent/10',
            )}
            style={{ width: col.width }}
          >
            {col.key === 'name' ? (
              <div className="flex w-full items-center" style={{ paddingLeft: depth * 14 }}>
                {hasChildren ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggle(task.id); }}
                    className="mr-1 text-content-muted hover:text-content"
                    aria-label={task.collapsed ? '펼치기' : '접기'}
                  >
                    {task.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </button>
                ) : (
                  <span className="mr-1 inline-block w-[14px]">
                    {task.isMilestone && <Diamond size={11} className="text-violet-400" />}
                  </span>
                )}
                <GridCell
                  task={task}
                  field="name"
                  className={cn(hasChildren && 'font-semibold', task.cancelled && 'line-through text-content-muted')}
                  editRequest={editRequest?.colKey === 'name' ? editRequest : null}
                  onEditConsumed={onEditConsumed}
                  onEditNavigate={onEditNavigate}
                />
                {task.manuallyScheduled && (
                  <span title="수동 고정 — 의존성 무시됨. 작업 상세에서 해제 가능">
                    <Lock size={9} className="ml-1 shrink-0 text-content-muted/50" />
                  </span>
                )}
                {taskGroups.length > 0 && (
                  <div className="ml-1 flex shrink-0 gap-0.5" title={taskGroups.map((g) => g.name).join(', ')}>
                    {taskGroups.slice(0, 4).map((g) => (
                      <span key={g.id} className="h-2 w-2 rounded-full" style={{ background: g.color }} />
                    ))}
                  </div>
                )}
              </div>
            ) : col.key === 'wbs' ? (
              <span className="text-content-muted">{wbs}</span>
            ) : col.key === 'duration' ? (
              <span>{task.isMilestone ? '—' : `${task.durationDays}d`}</span>
            ) : col.key === 'assignee' ? (
              <AssigneeCell task={task} />
            ) : col.key === 'start' ? (
              <GridCell task={task} field="start"
                editRequest={editRequest?.colKey === 'start' ? editRequest : null}
                onEditConsumed={onEditConsumed} onEditNavigate={onEditNavigate} />
            ) : col.key === 'end' ? (
              <GridCell task={task} field="end"
                editRequest={editRequest?.colKey === 'end' ? editRequest : null}
                onEditConsumed={onEditConsumed} onEditNavigate={onEditNavigate} />
            ) : col.key === 'progress' ? (
              <GridCell task={task} field="progress"
                editRequest={editRequest?.colKey === 'progress' ? editRequest : null}
                onEditConsumed={onEditConsumed} onEditNavigate={onEditNavigate} />
            ) : col.key === 'priority' ? (
              <PriorityCell task={task} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
});

// ---------------------------------------------------------------------------
// PriorityCell / AssigneeCell
// ---------------------------------------------------------------------------

function priorityClass(p: Priority): string {
  switch (p) {
    case 'critical': return 'bg-critical/20 text-critical';
    case 'high':     return 'bg-amber-500/20 text-amber-500';
    case 'medium':   return 'bg-blue-500/20 text-blue-400';
    default:         return 'bg-surface-3 text-content-muted';
  }
}

function PriorityCell({ task }: { task: Task }) {
  const [editing, setEditing] = useState(false);
  const updateTask = useProjectStore((s) => s.updateTask);

  if (editing) {
    return (
      <select
        autoFocus
        value={task.priority}
        onChange={(e) => { updateTask(task.id, { priority: e.target.value as Priority }); setEditing(false); }}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); e.stopPropagation(); }}
        onMouseDown={(e) => e.stopPropagation()}
        className="h-6 w-full rounded border border-accent bg-surface px-1 text-xs text-content outline-none"
      >
        <option value="low">낮음</option>
        <option value="medium">보통</option>
        <option value="high">높음</option>
        <option value="critical">긴급</option>
      </select>
    );
  }

  return (
    <span
      className={cn('cursor-pointer rounded px-1.5 py-0.5 text-2xs', priorityClass(task.priority))}
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
      title="더블클릭하여 우선순위 변경"
    >
      {PRIORITY_LABELS[task.priority]}
    </span>
  );
}

function AssigneeCell({ task }: { task: Task }) {
  const [open, setOpen]         = useState(false);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });
  const resources  = useProjectStore((s) => s.derived.project.resources);
  const updateTask = useProjectStore((s) => s.updateTask);

  const displayText = task.assigneeIds
    .map((id) => resources.find((r) => r.id === id)?.name)
    .filter(Boolean).join(', ');

  const openDropdown = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPanelPos({ top: rect.bottom + 2, left: rect.left });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const panel = document.getElementById('assignee-panel-' + task.id);
      if (panel?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const tid = setTimeout(() => window.addEventListener('mousedown', close), 50);
    return () => { clearTimeout(tid); window.removeEventListener('mousedown', close); };
  }, [open, task.id]);

  const toggle = (resourceId: string) => {
    const cur = new Set(task.assigneeIds);
    if (cur.has(resourceId)) cur.delete(resourceId); else cur.add(resourceId);
    updateTask(task.id, { assigneeIds: [...cur] });
  };

  return (
    <>
      <span
        className="w-full cursor-pointer truncate text-content-muted"
        onDoubleClick={openDropdown}
        title={displayText || '더블클릭하여 담당자 지정'}
      >
        {displayText || '—'}
      </span>
      {open && createPortal(
        <div
          id={'assignee-panel-' + task.id}
          style={{ position: 'fixed', top: panelPos.top, left: panelPos.left, zIndex: 9999 }}
          className="min-w-[150px] rounded-md border border-border bg-surface-2 py-1 shadow-xl text-xs"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {resources.length === 0 ? (
            <div className="px-3 py-2 text-content-muted">담당자가 없습니다</div>
          ) : resources.map((r) => (
            <label key={r.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-surface-3">
              <input
                type="checkbox"
                checked={task.assigneeIds.includes(r.id)}
                onChange={() => toggle(r.id)}
                className="h-3 w-3 accent-accent"
              />
              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: r.color ?? '#888' }} />
              {r.name}
            </label>
          ))}
          <button
            className="mt-1 w-full border-t border-border px-3 py-1.5 text-left text-content-muted hover:bg-surface-3"
            onClick={() => setOpen(false)}
          >
            완료
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
