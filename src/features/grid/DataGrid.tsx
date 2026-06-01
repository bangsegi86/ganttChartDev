import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Diamond } from 'lucide-react';
import { useProjectStore } from '@/app/store/useProjectStore';
import { buildVisibleRows, type VisibleRow } from './treeModel';
import { useVisibleTasks } from '@/features/view/viewFilter';
import { HEADER_HEIGHT, ROW_HEIGHT, SCROLL_BOTTOM_PADDING } from '@/features/gantt/layout';
import { cn } from '@/shared/ui/cn';
import type { Priority, Task } from '@/entities';
import { GridCell } from './GridCell';

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

type SortKey = 'none' | 'name' | 'start' | 'end' | 'progress';

interface DataGridProps {
  width: number;
  scrollTop: number;
  onScrollTopChange: (top: number) => void;
}

/**
 * Left-hand WBS grid. Rows are virtualised and kept row-aligned with the gantt
 * via a shared `scrollTop`. Supports inline editing, hierarchy collapse,
 * multi-select, column resizing, a name filter and column sort.
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
  /** Prevents scroll-event feedback when programmatically setting scrollTop. */
  const isSyncingRef = useRef(false);
  /** Anchor row for Shift+click range selection. Set on every plain/Ctrl click. */
  const anchorIdRef = useRef<string | null>(null);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const text = e.clipboardData.getData('text');
      if (!text.trim()) return;
      e.preventDefault();
      importTsvTasks(text);
    },
    [importTsvTasks],
  );

  const scrollerRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<SortKey>('none');

  const visibleTasks = useVisibleTasks();
  const allRows = useMemo(() => buildVisibleRows(visibleTasks), [visibleTasks]);

  // Apply filter/sort to a *flat* view (sorting flattens the hierarchy display).
  const rows = useMemo(() => {
    let result = allRows;
    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
      result = result.filter((r) => r.task.name.toLowerCase().includes(q));
    }
    if (sort !== 'none') {
      result = [...result].sort((a, b) => compareTasks(a.task, b.task, sort));
    }
    return result;
  }, [allRows, filter, sort]);

  // Sync external scrollTop (from gantt) into our scroller, suppressing feedback.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || Math.abs(el.scrollTop - scrollTop) <= 0.5) return;
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

  const cycleSort = (key: string) => {
    if (key === 'name' || key === 'start' || key === 'end' || key === 'progress') {
      setSort((prev) => (prev === key ? 'none' : (key as SortKey)));
    }
  };

  return (
    <div className="flex h-full flex-col border-r border-border bg-surface" style={{ width }} onPaste={handlePaste}>
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
            onClick={() => cycleSort(col.key)}
            role="columnheader"
          >
            <span className="truncate">{col.label}</span>
            {sort === col.key && <span className="ml-1">▲</span>}
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
        onScroll={(e) => { if (!isSyncingRef.current) onScrollTopChange(e.currentTarget.scrollTop); }}
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
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface GridRowProps {
  row: VisibleRow;
  columns: ColumnDef[];
  top: number;
  selected: boolean;
  critical: boolean;
  onSelect: (isCtrl: boolean, isShift: boolean) => void;
  onToggle: () => void;
  onIndent: () => void;
  onOutdent: () => void;
}

function GridRow({
  row,
  columns,
  top,
  selected,
  critical,
  onSelect,
  onToggle,
  onIndent,
  onOutdent,
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
        'absolute left-0 flex w-full items-stretch border-b border-border text-xs',
        task.cancelled && 'opacity-50',
        selected ? 'bg-accent/15' : hasChildren ? 'bg-surface-2/40' : 'hover:bg-surface-2/60',
      )}
      style={{ top, height: ROW_HEIGHT }}
      onMouseDown={(e) => onSelect(e.ctrlKey || e.metaKey, e.shiftKey)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="row"
      aria-selected={selected}
    >
      {columns.map((col) => (
        <div
          key={col.key}
          className={cn(
            'flex items-center overflow-hidden border-r border-border px-2',
            col.align === 'right' && 'justify-end',
            col.align === 'center' && 'justify-center',
            critical && col.key === 'name' && 'text-critical',
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

function compareTasks(a: Task, b: Task, key: SortKey): number {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name);
    case 'start':
      return a.start.localeCompare(b.start);
    case 'end':
      return a.end.localeCompare(b.end);
    case 'progress':
      return b.progress - a.progress;
    default:
      return 0;
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
