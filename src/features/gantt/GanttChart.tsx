import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useProjectStore } from '@/app/store/useProjectStore';
import { buildVisibleRows, rowIndexMap } from '@/features/grid/treeModel';
import { useVisibleTasks } from '@/features/view/viewFilter';
import { buildTimeline } from './timeline';
import { ZOOM_CONFIGS } from './zoom';
import { readPalette } from './colors';
import {
  renderGanttBody,
  renderGanttHeader,
  type BarRect,
  type GanttRenderModel,
} from './renderGantt';
import { HEADER_HEIGHT, RESIZE_HANDLE, ROW_HEIGHT } from './layout';
import type { BaselineEntry, Task, TaskId } from '@/entities';
import { addDaysISO } from '@/shared/date/dateUtils';

type DragMode = 'move' | 'resize-start' | 'resize-end' | 'link' | 'pan' | null;

interface DragState {
  mode: DragMode;
  taskId: TaskId | null;
  startClientX: number;
  startClientY: number;
  startScrollLeft: number;
  startScrollTop: number;
  deltaDays: number;
  cursorX: number;
  cursorY: number;
}

const NO_DRAG: DragState = {
  mode: null,
  taskId: null,
  startClientX: 0,
  startClientY: 0,
  startScrollLeft: 0,
  startScrollTop: 0,
  deltaDays: 0,
  cursorX: 0,
  cursorY: 0,
};

interface GanttChartProps {
  /** Synced vertical scroll position shared with the grid. */
  scrollTop: number;
  onScrollTopChange: (top: number) => void;
}

/**
 * Canvas-based gantt timeline. Renders only the visible viewport for
 * performance, syncs vertical scroll with the data grid, and handles bar
 * move/resize, dependency linking, panning and ctrl-wheel zoom.
 */
export function GanttChart({ scrollTop, onScrollTopChange }: GanttChartProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bodyCanvasRef = useRef<HTMLCanvasElement>(null);
  const headerCanvasRef = useRef<HTMLCanvasElement>(null);
  const barsRef = useRef<BarRect[]>([]);
  const dragRef = useRef<DragState>(NO_DRAG);
  const spaceHeldRef = useRef(false);

  const derived = useProjectStore((s) => s.derived);
  const view = useProjectStore((s) => s.view);
  const selected = useProjectStore((s) => s.selectedTaskIds);
  const linkSourceId = useProjectStore((s) => s.linkSourceId);

  const project = derived.project;
  const zoom = ZOOM_CONFIGS[view.zoom];

  const visibleTasks = useVisibleTasks();
  const rows = useMemo(() => buildVisibleRows(visibleTasks), [visibleTasks]);
  const rowIndex = useMemo(() => rowIndexMap(rows), [rows]);
  const timeline = useMemo(
    () => buildTimeline(visibleTasks, project.startDate, zoom.dayWidth),
    [visibleTasks, project.startDate, zoom.dayWidth],
  );

  const taskGroupColor = useMemo<Map<TaskId, string>>(() => {
    const map = new Map<TaskId, string>();
    for (const g of project.viewGroups) {
      for (const tid of g.taskIds) {
        if (!map.has(tid)) map.set(tid, g.color); // first group wins
      }
    }
    return map;
  }, [project.viewGroups]);

  const baselineMap = useMemo<Map<TaskId, BaselineEntry> | null>(() => {
    if (!project.activeBaselineId) return null;
    const b = project.baselines.find((x) => x.id === project.activeBaselineId);
    if (!b) return null;
    return new Map(b.entries.map((e) => [e.taskId, e]));
  }, [project.activeBaselineId, project.baselines]);

  /** Build the immutable render model, applying any live drag preview. */
  const buildModel = useCallback((): GanttRenderModel => {
    const palette = readPalette(view.theme);
    const drag = dragRef.current;
    let renderRows = rows;
    if (drag.mode && drag.taskId && drag.deltaDays !== 0) {
      renderRows = rows.map((r) => {
        if (r.task.id !== drag.taskId) return r;
        return { ...r, task: applyDragPreview(r.task, drag) };
      });
    }
    return {
      rows: renderRows,
      timeline,
      zoom,
      palette,
      schedules: derived.schedules,
      dependencies: project.dependencies,
      rowIndex,
      selected,
      holidaySet: new Set(project.holidays.map((h) => h.date)),
      weekendDays: new Set([0, 6].filter((d) => !project.calendar.workingWeekdays.includes(d))),
      today: new Date().toISOString().slice(0, 10),
      showCritical: view.showCriticalPath,
      showBaseline: view.showBaseline,
      baseline: baselineMap,
      taskGroupColor,
    };
  }, [rows, timeline, zoom, derived.schedules, project, rowIndex, selected, view, baselineMap, taskGroupColor]);

  /** Repaint header + body for the current scroll position. */
  const draw = useCallback(() => {
    const scroller = scrollerRef.current;
    const body = bodyCanvasRef.current;
    const header = headerCanvasRef.current;
    if (!scroller || !body || !header) return;

    const dpr = window.devicePixelRatio || 1;
    const vw = scroller.clientWidth;
    const vh = scroller.clientHeight;
    const sl = scroller.scrollLeft;
    const st = scroller.scrollTop;

    // Size + pin the body canvas to the viewport.
    setCanvasSize(body, vw, vh, dpr);
    body.style.transform = `translate(${sl}px, ${st}px)`;
    const bctx = body.getContext('2d')!;
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const model = buildModel();
    barsRef.current = renderGanttBody(bctx, model, vw, vh, sl, st);

    // Header.
    setCanvasSize(header, vw, HEADER_HEIGHT, dpr);
    const hctx = header.getContext('2d')!;
    hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderGanttHeader(hctx, model, vw, HEADER_HEIGHT, sl);

    // Live link-drag rubber-band line.
    const drag = dragRef.current;
    if (drag.mode === 'link' && drag.taskId) {
      const fromBar = barsRef.current.find((b) => b.taskId === drag.taskId);
      if (fromBar) {
        bctx.strokeStyle = model.palette.today;
        bctx.lineWidth = 2;
        bctx.setLineDash([4, 2]);
        bctx.beginPath();
        bctx.moveTo(fromBar.x + fromBar.w, fromBar.y + fromBar.h / 2);
        bctx.lineTo(drag.cursorX, drag.cursorY);
        bctx.stroke();
        bctx.setLineDash([]);
      }
    }
  }, [buildModel]);

  // Redraw whenever inputs change.
  useEffect(() => {
    draw();
  }, [draw, scrollTop]);

  // Keep canvas crisp on container resize.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [draw]);

  // Track Space for pan mode.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTextTarget(e.target)) spaceHeldRef.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeldRef.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const handleScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    onScrollTopChange(scroller.scrollTop);
    draw();
  }, [draw, onScrollTopChange]);

  // External vertical scroll (from the grid) → apply to our scroller.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller && Math.abs(scroller.scrollTop - scrollTop) > 0.5) {
      scroller.scrollTop = scrollTop;
      draw();
    }
  }, [scrollTop, draw]);

  // --- pointer interactions --------------------------------------------------

  const hitTest = (clientX: number, clientY: number): { bar: BarRect | null; edge: DragMode } => {
    const scroller = scrollerRef.current!;
    const rect = scroller.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    for (const bar of barsRef.current) {
      if (y >= bar.y - 4 && y <= bar.y + bar.h + 4 && x >= bar.x - 4 && x <= bar.x + bar.w + 4) {
        if (!bar.isMilestone && x <= bar.x + RESIZE_HANDLE) return { bar, edge: 'resize-start' };
        if (!bar.isMilestone && x >= bar.x + bar.w - RESIZE_HANDLE) return { bar, edge: 'resize-end' };
        return { bar, edge: 'move' };
      }
    }
    return { bar: null, edge: null };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const scroller = scrollerRef.current!;
    const store = useProjectStore.getState();
    const panning = spaceHeldRef.current || e.button === 1;

    if (panning) {
      dragRef.current = {
        ...NO_DRAG,
        mode: 'pan',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startScrollLeft: scroller.scrollLeft,
        startScrollTop: scroller.scrollTop,
      };
      e.preventDefault();
      return;
    }

    const { bar, edge } = hitTest(e.clientX, e.clientY);
    if (!bar) {
      store.clearSelection();
      return;
    }
    store.selectTask(bar.taskId, e.ctrlKey || e.metaKey);

    // Alt-drag from a bar starts a dependency link.
    const mode: DragMode = e.altKey ? 'link' : edge;
    const rect = scroller.getBoundingClientRect();
    dragRef.current = {
      mode,
      taskId: bar.taskId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startScrollLeft: scroller.scrollLeft,
      startScrollTop: scroller.scrollTop,
      deltaDays: 0,
      cursorX: e.clientX - rect.left,
      cursorY: e.clientY - rect.top,
    };
    if (mode === 'link') store.beginLink(bar.taskId);
    window.addEventListener('mousemove', onWindowMove);
    window.addEventListener('mouseup', onWindowUp);
  };

  const onWindowMove = useCallback(
    (e: MouseEvent) => {
      const scroller = scrollerRef.current;
      const drag = dragRef.current;
      if (!scroller || !drag.mode) return;
      const rect = scroller.getBoundingClientRect();

      if (drag.mode === 'pan') {
        scroller.scrollLeft = drag.startScrollLeft - (e.clientX - drag.startClientX);
        scroller.scrollTop = drag.startScrollTop - (e.clientY - drag.startClientY);
        onScrollTopChange(scroller.scrollTop);
        draw();
        return;
      }

      const dx = e.clientX - drag.startClientX;
      drag.deltaDays = Math.round(dx / timeline.dayWidth);
      drag.cursorX = e.clientX - rect.left;
      drag.cursorY = e.clientY - rect.top;
      draw();
    },
    [draw, timeline.dayWidth, onScrollTopChange],
  );

  const onWindowUp = useCallback(
    (e: MouseEvent) => {
      const drag = dragRef.current;
      const store = useProjectStore.getState();
      if (drag.mode && drag.taskId) {
        if (drag.mode === 'move' && drag.deltaDays !== 0) {
          store.moveTaskBy(drag.taskId, drag.deltaDays);
        } else if (drag.mode === 'resize-start' && drag.deltaDays !== 0) {
          store.resizeTask(drag.taskId, 'start', drag.deltaDays);
        } else if (drag.mode === 'resize-end' && drag.deltaDays !== 0) {
          store.resizeTask(drag.taskId, 'end', drag.deltaDays);
        } else if (drag.mode === 'link') {
          const { bar } = hitTest(e.clientX, e.clientY);
          if (bar && bar.taskId !== drag.taskId) {
            store.addDependency(drag.taskId, bar.taskId, 'FS');
          }
          store.beginLink(null);
        }
      }
      dragRef.current = NO_DRAG;
      window.removeEventListener('mousemove', onWindowMove);
      window.removeEventListener('mouseup', onWindowUp);
      draw();
    },
    [draw, onWindowMove],
  );

  const onDoubleClick = (e: React.MouseEvent) => {
    const { bar } = hitTest(e.clientX, e.clientY);
    if (bar) useProjectStore.getState().setInspecting(bar.taskId);
  };

  // Ctrl+wheel zoom centred on the cursor's date.
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    useProjectStore.getState().zoomBy(e.deltaY < 0 ? 1 : -1);
  };

  const contentHeight = rows.length * ROW_HEIGHT;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-surface">
      <div className="relative" style={{ height: HEADER_HEIGHT }}>
        <canvas ref={headerCanvasRef} className="block h-full w-full" />
      </div>
      <div
        ref={scrollerRef}
        className="relative flex-1 overflow-auto"
        onScroll={handleScroll}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        style={{ cursor: spaceHeldRef.current ? 'grab' : 'default' }}
        role="application"
        aria-label="간트 타임라인"
      >
        <div style={{ width: timeline.width, height: contentHeight }} />
        <canvas
          ref={bodyCanvasRef}
          className="pointer-events-none absolute left-0 top-0"
          style={{ willChange: 'transform' }}
        />
        {linkSourceId && (
          <div className="pointer-events-none absolute left-2 top-2 rounded bg-accent px-2 py-1 text-2xs text-accent-fg">
            연결할 대상 작업으로 드래그하세요
          </div>
        )}
      </div>
    </div>
  );
}

// --- helpers -----------------------------------------------------------------

function applyDragPreview(task: Task, drag: DragState): Task {
  if (drag.mode === 'move') {
    return { ...task, start: addDaysISO(task.start, drag.deltaDays), end: addDaysISO(task.end, drag.deltaDays) };
  }
  if (drag.mode === 'resize-start') {
    const ns = addDaysISO(task.start, drag.deltaDays);
    return ns <= task.end ? { ...task, start: ns } : task;
  }
  if (drag.mode === 'resize-end') {
    const ne = addDaysISO(task.end, drag.deltaDays);
    return ne >= task.start ? { ...task, end: ne } : task;
  }
  return task;
}

function setCanvasSize(canvas: HTMLCanvasElement, w: number, h: number, dpr: number): void {
  const bw = Math.floor(w * dpr);
  const bh = Math.floor(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
}

function isTextTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}
