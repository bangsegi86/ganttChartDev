import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Diamond, GripVertical, Lock } from 'lucide-react';
import { useProjectStore } from '@/app/store/useProjectStore';
import { buildVisibleRows, type VisibleRow } from './treeModel';
import { useVisibleTasks } from '@/features/view/viewFilter';
import { HEADER_HEIGHT, ROW_HEIGHT, SCROLL_BOTTOM_PADDING } from '@/features/gantt/layout';
import { cn } from '@/shared/ui/cn';
import type { Priority, Task } from '@/entities';
import { GridCell } from './GridCell';
import { readClipboardText, writeClipboardText } from '@/shared/clipboard';

interface ColumnDef {
  key: string;
  label: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

const DEFAULT_COLUMNS: ColumnDef[] = [
  { key: 'wbs', label: 'WBS', width: 56, align: 'right' },
  { key: 'name', label: '작업명', width: 220 },
  { key: 'start', label: '시작', width: 104 },
  { key: 'end', label: '종료', width: 104 },
  { key: 'duration', label: '기간', width: 56, align: 'right' },
  { key: 'assignee', label: '담당자', width: 110 },
  { key: 'progress', label: '진척', width: 64, align: 'right' },
  { key: 'priority', label: '우선순위', width: 84 },
];

const PRIORITY_LABELS: Record<Priority, string> = {
  low: '낮음',
  medium: '보통',
  high: '높음',
  critical: '긴급',
};

interface DataGridProps {
  width: number;
  scrollTop: number;
  onScrollTopChange: (top: number) => void;
}

/**
 * Left-hand WBS grid. Rows are virtualised and kept row-aligned with the gantt
 * via a shared `scrollTop`. Supports inline editing, hierarchy collapse,
 * multi-select, column resizing, and a name filter.
 */
export function DataGrid({ width, scrollTop, onScrollTopChange }: DataGridProps) {
  const schedules = useProjectStore((s) => s.derived.schedules);
  const selected = useProjectStore((s) => s.selectedTaskIds);
  const showCritical = useProjectStore((s) => s.view.showCriticalPath);
  const selectTask = useProjectStore((s) => s.selectTask);
  const setSelectedTaskIds = useProjectStore((s) => s.setSelectedTaskIds);
  const toggleCollapse = useProjectStore((s) => s.toggleCollapse);
  const indentTask = useProjectStore((s) => s.indentTask);
  const outdentTask = useProjectStore((s) => s.outdentTask);
  const importTsvTasks = useProjectStore((s) => s.importTsvTasks);
  const updateTasksFromTsv = useProjectStore((s) => s.updateTasksFromTsv);
  const updateTask = useProjectStore((s) => s.updateTask);
  const moveTaskBefore = useProjectStore((s) => s.moveTaskBefore);
  const addTasksToGroup = useProjectStore((s) => s.addTasksToGroup);
  const removeTasksFromGroup = useProjectStore((s) => s.removeTasksFromGroup);
  const viewGroups = useProjectStore((s) => s.derived.project.viewGroups);
  /** Prevents scroll-event feedback when programmatically setting scrollTop. */
  const isSyncingRef = useRef(false);
  /** True while the user is actively scrolling this panel; guards against
   *  the sync effect snapping back to a stale scrollTop (RAF-throttle lag). */
  const isUserScrollingRef = useRef(false);
  const clearUserScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Anchor row for Shift+click range selection. Set on every plain/Ctrl click. */
  const anchorIdRef = useRef<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; taskId: string } | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ taskId: string; colKey: string } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [filter, setFilter] = useState('');

  const visibleTasks = useVisibleTasks();
  const allRows = useMemo(() => buildVisibleRows(visibleTasks), [visibleTasks]);

  const rows = useMemo(() => {
    if (!filter.trim()) return allRows;
    const q = filter.trim().toLowerCase();
    return allRows.filter((r) => r.task.name.toLowerCase().includes(q));
  }, [allRows, filter]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [contextMenu]);

  // Sync external scrollTop (from gantt) into our scroller, suppressing feedback.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || Math.abs(el.scrollTop - scrollTop) <= 0.5) return;
    // Skip if the user is actively scrolling this panel to avoid snapping back.
    if (isUserScrollingRef.current) return;
    isSyncingRef.current = true;
    el.scrollTop = scrollTop;
    requestAnimationFrame(() => { isSyncingRef.current = false; });
  }, [scrollTop]);

  const viewportH = scrollerRef.current?.clientHeight ?? 800;
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 4);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + 4);
  const visible = rows.slice(first, last);

  const totalWidth = columns.reduce((s, c) => s + c.width, 0);

  const startColumnResize = (key: string, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const col = columns.find((c) => c.key === key)!;
    const startW = col.width;
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

  const PRIORITY_KO: Record<string, string> = { low: '낮음', medium: '보통', high: '높음', critical: '긴급' };
  const PRIORITY_FROM_KO: Record<string, string> = { '낮음': 'low', '보통': 'medium', '높음': 'high', '긴급': 'critical' };

  // Refs so the keydown handler never goes stale without re-registering.
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  const selectedRef = useRef(selected);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  const selectedCellRef = useRef(selectedCell);
  useEffect(() => { selectedCellRef.current = selectedCell; }, [selectedCell]);
  const updateTaskRef = useRef(updateTask);
  useEffect(() => { updateTaskRef.current = updateTask; }, [updateTask]);
  const importTsvTasksRef = useRef(importTsvTasks);
  useEffect(() => { importTsvTasksRef.current = importTsvTasks; }, [importTsvTasks]);
  const updateTasksFromTsvRef = useRef(updateTasksFromTsv);
  useEffect(() => { updateTasksFromTsvRef.current = updateTasksFromTsv; }, [updateTasksFromTsv]);

  // Track whether the grid area was the last thing the user clicked.
  // This is more reliable than checking document.activeElement because
  // column headers and empty scroller space are not focusable — clicking
  // them leaves activeElement as body, which is not inside containerRef.
  const gridActiveRef = useRef(false);
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      gridActiveRef.current = Boolean(containerRef.current?.contains(e.target as Node));
    };
    window.addEventListener('mousedown', onMouseDown, true);
    return () => window.removeEventListener('mousedown', onMouseDown, true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!gridActiveRef.current) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      // Skip if focus is on a text-editing element (allow native copy/paste there).
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      const key = e.key.toLowerCase();
      const curRows = rowsRef.current;
      const curSelected = selectedRef.current;
      const curCell = selectedCellRef.current;

      if (key === 'c') {
        e.preventDefault();
        if (curCell) {
          const task = curRows.find((r) => r.task.id === curCell.taskId)?.task;
          if (!task) return;
          let val = '';
          switch (curCell.colKey) {
            case 'name': val = task.name; break;
            case 'start': val = task.start; break;
            case 'end': val = task.end; break;
            case 'progress': val = String(task.progress); break;
            case 'priority': val = PRIORITY_KO[task.priority] ?? task.priority; break;
            case 'duration': val = String(task.durationDays); break;
          }
          void writeClipboardText(val);
          return;
        }
        if (curSelected.size === 0) return;
        const selectedRows = curRows.filter((r) => curSelected.has(r.task.id));
        const header = ['작업명', '시작', '종료', '기간(일)', '진척(%)', '우선순위'].join('\t');
        const lines = selectedRows.map((r) => {
          const t = r.task;
          return [t.name, t.start, t.end, t.durationDays, t.progress, PRIORITY_KO[t.priority] ?? t.priority].join('\t');
        });
        void writeClipboardText([header, ...lines].join('\n'));
        return;
      }

      if (key === 'v') {
        e.preventDefault();
        void readClipboardText().then((text) => {
          const trimmed = text.trim();
          if (!trimmed) return;
          const cell = selectedCellRef.current;
          if (cell) {
            const { taskId, colKey } = cell;
            const upd = updateTaskRef.current;
            switch (colKey) {
              case 'name': upd(taskId, { name: trimmed.slice(0, 200) }); break;
              case 'start': if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) upd(taskId, { start: trimmed }); break;
              case 'end':   if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) upd(taskId, { end: trimmed }); break;
              case 'progress': { const n = Math.max(0, Math.min(100, parseInt(trimmed, 10) || 0)); upd(taskId, { progress: n }); break; }
              case 'priority': {
                const p = PRIORITY_FROM_KO[trimmed] ?? (['low','medium','high','critical'].includes(trimmed) ? trimmed : null);
                if (p) upd(taskId, { priority: p as 'low'|'medium'|'high'|'critical' });
                break;
              }
            }
            return;
          }
          const curRows2 = rowsRef.current;
          const curSel = selectedRef.current;
          const selectedIds = curRows2.filter((r) => curSel.has(r.task.id)).map((r) => r.task.id);
          if (selectedIds.length > 0) {
            updateTasksFromTsvRef.current(selectedIds, trimmed);
          } else {
            importTsvTasksRef.current(trimmed);
          }
        });
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // empty deps — all values accessed via refs

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-col border-r border-border bg-surface outline-none"
      style={{ width }}
    >
      {/* Filter row */}
      <div className="flex items-center gap-2 border-b border-border px-2" style={{ height: 28 }}>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="작업 검색…"
          className="h-6 w-full rounded bg-surface-2 px-2 text-xs text-content outline-none placeholder:text-content-muted"
          aria-label="작업 검색"
        />
      </div>

      {/* Column header */}
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

      {/* Rows */}
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
          {visible.map((row, visIdx) => (
            <GridRow
              key={row.task.id}
              row={row}
              columns={columns}
              top={(first + visIdx) * ROW_HEIGHT}
              selected={selected.has(row.task.id)}
              critical={showCritical && (schedules.get(row.task.id)?.isCritical ?? false)}
              isDragOver={dropTargetId === row.task.id}
              selectedCellKey={selectedCell?.taskId === row.task.id ? selectedCell.colKey : null}
              onCellSelect={(colKey) => setSelectedCell({ taskId: row.task.id, colKey })}
              onSelect={(isCtrl, isShift) => {
                const id = row.task.id;
                if (isShift && anchorIdRef.current) {
                  const anchorIdx = rows.findIndex((r) => r.task.id === anchorIdRef.current);
                  const currentIdx = rows.findIndex((r) => r.task.id === id);
                  if (anchorIdx !== -1 && currentIdx !== -1) {
                    const lo = Math.min(anchorIdx, currentIdx);
                    const hi = Math.max(anchorIdx, currentIdx);
                    setSelectedTaskIds(new Set(rows.slice(lo, hi + 1).map((r) => r.task.id)));
                    return;
                  }
                }
                // Plain click or Ctrl+click — update anchor.
                anchorIdRef.current = id;
                selectTask(id, isCtrl);
              }}
              onToggle={() => toggleCollapse(row.task.id)}
              onIndent={() => indentTask(row.task.id)}
              onOutdent={() => outdentTask(row.task.id)}
              onDragStart={() => { dragIdRef.current = row.task.id; }}
              onDragEnd={() => { dragIdRef.current = null; setDropTargetId(null); }}
              onDragOver={() => setDropTargetId(row.task.id)}
              onDrop={() => {
                if (dragIdRef.current && dropTargetId) {
                  moveTaskBefore(dragIdRef.current, dropTargetId);
                }
                dragIdRef.current = null;
                setDropTargetId(null);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenu({ x: e.clientX, y: e.clientY, taskId: row.task.id });
              }}
            />
          ))}
        </div>
      </div>

      {contextMenu && createPortal(
        <div
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 9999 }}
          className="min-w-[160px] rounded-md border border-border bg-surface-2 py-1 shadow-xl text-xs"
          onMouseDown={(e) => e.stopPropagation()}
        >
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

interface GridRowProps {
  row: VisibleRow;
  columns: ColumnDef[];
  top: number;
  selected: boolean;
  critical: boolean;
  isDragOver: boolean;
  selectedCellKey: string | null;
  onSelect: (isCtrl: boolean, isShift: boolean) => void;
  onCellSelect: (colKey: string) => void;
  onToggle: () => void;
  onIndent: () => void;
  onOutdent: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function GridRow({
  row,
  columns,
  top,
  selected,
  critical,
  isDragOver,
  selectedCellKey,
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
  const project = useProjectStore((s) => s.derived.project);
  const taskGroups = project.viewGroups.filter((g) => g.taskIds.includes(task.id));

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) onOutdent();
      else onIndent();
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
      onMouseDown={(e) => onSelect(e.ctrlKey || e.metaKey, e.shiftKey)}
      onKeyDown={handleKeyDown}
      onDragStart={(e) => { e.stopPropagation(); onDragStart(); }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      onContextMenu={onContextMenu}
      tabIndex={0}
      role="row"
      aria-selected={selected}
    >
      <div className="pointer-events-none absolute left-0.5 top-0 z-[1] flex h-full items-center text-content-muted opacity-0 group-hover/row:opacity-40">
        <GripVertical size={11} />
      </div>
      {columns.map((col) => (
        <div
          key={col.key}
          onClick={(e) => { e.stopPropagation(); onCellSelect(col.key); }}
          className={cn(
            'flex items-center overflow-hidden border-r border-border px-2',
            col.align === 'right' && 'justify-end',
            col.align === 'center' && 'justify-center',
            critical && col.key === 'name' && 'text-critical',
            selectedCellKey === col.key && 'ring-1 ring-inset ring-accent',
          )}
          style={{ width: col.width }}
        >
          {col.key === 'name' ? (
            <div className="flex w-full items-center" style={{ paddingLeft: depth * 14 }}>
              {hasChildren ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle();
                  }}
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
              <GridCell task={task} field="name" className={cn(hasChildren && 'font-semibold', task.cancelled && 'line-through text-content-muted')} />
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
            <GridCell task={task} field="start" />
          ) : col.key === 'end' ? (
            <GridCell task={task} field="end" />
          ) : col.key === 'progress' ? (
            <GridCell task={task} field="progress" />
          ) : col.key === 'priority' ? (
            <PriorityCell task={task} />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function priorityClass(p: Priority): string {
  switch (p) {
    case 'critical':
      return 'bg-critical/20 text-critical';
    case 'high':
      return 'bg-amber-500/20 text-amber-500';
    case 'medium':
      return 'bg-blue-500/20 text-blue-400';
    default:
      return 'bg-surface-3 text-content-muted';
  }
}

// ---------------------------------------------------------------------------
// Inline editors for priority and assignee columns
// ---------------------------------------------------------------------------

function PriorityCell({ task }: { task: Task }) {
  const [editing, setEditing] = useState(false);
  const updateTask = useProjectStore((s) => s.updateTask);

  if (editing) {
    return (
      <select
        autoFocus
        value={task.priority}
        onChange={(e) => {
          updateTask(task.id, { priority: e.target.value as Priority });
          setEditing(false);
        }}
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
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });
  const resources = useProjectStore((s) => s.derived.project.resources);
  const updateTask = useProjectStore((s) => s.updateTask);

  const displayText = task.assigneeIds
    .map((id) => resources.find((r) => r.id === id)?.name)
    .filter(Boolean)
    .join(', ');

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
      if (panel && panel.contains(e.target as Node)) return;
      setOpen(false);
    };
    // Slight delay so the opening click doesn't immediately close.
    const tid = setTimeout(() => window.addEventListener('mousedown', close), 50);
    return () => { clearTimeout(tid); window.removeEventListener('mousedown', close); };
  }, [open, task.id]);

  const toggle = (resourceId: string) => {
    const current = new Set(task.assigneeIds);
    if (current.has(resourceId)) current.delete(resourceId);
    else current.add(resourceId);
    updateTask(task.id, { assigneeIds: [...current] });
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
          ) : (
            resources.map((r) => (
              <label
                key={r.id}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-surface-3"
              >
                <input
                  type="checkbox"
                  checked={task.assigneeIds.includes(r.id)}
                  onChange={() => toggle(r.id)}
                  className="h-3 w-3 accent-accent"
                />
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ background: r.color ?? '#888' }}
                />
                {r.name}
              </label>
            ))
          )}
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
