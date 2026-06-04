import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Hand, Minus, Plus } from 'lucide-react';
import { useProjectStore } from '@/app/store/useProjectStore';
import { buildVisibleRows, rowIndexMap } from '@/features/grid/treeModel';
import { useVisibleTasks } from '@/features/view/viewFilter';
import { buildTimeline } from './timeline';
import { ZOOM_CONFIGS } from './zoom';
import { readPalette } from './colors';
import {
  renderGanttBody,
  renderGanttHeader,
  computeDepHitboxes,
  type BarRect,
  type DepHitbox,
  type GanttRenderModel,
} from './renderGantt';
import { HEADER_HEIGHT, RESIZE_HANDLE, ROW_HEIGHT, SCROLL_BOTTOM_PADDING } from './layout';
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
  scrollTop: number;
  onScrollTopChange: (top: number) => void;
}

/**
 * Canvas-based gantt timeline. Handles bar move/resize/link/pan with full
 * cursor feedback, a live date-tooltip during drag, an undo toast on commit,
 * and blocks dragging of summary (parent) bars whose dates auto-derive from
 * their children.
 */
export function GanttChart({ scrollTop, onScrollTopChange }: GanttChartProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bodyCanvasRef = useRef<HTMLCanvasElement>(null);
  const headerCanvasRef = useRef<HTMLCanvasElement>(null);
  const barsRef = useRef<BarRect[]>([]);
  const depHitboxesRef = useRef<DepHitbox[]>([]);
  const selectedDepIdRef = useRef<string | null>(null);
  const dragRef = useRef<DragState>(NO_DRAG);
  const spaceHeldRef = useRef(false);
  const panModeRef = useRef(false);
  const [panMode, setPanMode] = useState(false);
  /** Prevents scroll-event feedback when we programmatically set scrollTop. */
  const isSyncingRef = useRef(false);
  /** True while the user is actively scrolling this panel; blocks the sync
   *  effect from snapping back to a stale scrollTop state (RAF-throttle lag). */
  const isUserScrollingRef = useRef(false);
  const clearUserScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // DOM refs for imperative tooltip + toast (avoids React state churning).
  const tooltipRef    = useRef<HTMLDivElement>(null);
  const barTipRef     = useRef<HTMLDivElement>(null);  // hover memo tooltip
  const toastRef      = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const derived = useProjectStore((s) => s.derived);
  const view = useProjectStore((s) => s.view);
  const selected = useProjectStore((s) => s.selectedTaskIds);
  const linkSourceId = useProjectStore((s) => s.linkSourceId);
  const scaleDayWidth = useProjectStore((s) => s.scaleDayWidth);
  const setDayWidthScale = useProjectStore((s) => s.setDayWidthScale);
  const ganttScrollTo = useProjectStore((s) => s.view.ganttScrollTo);
  const clearGanttScroll = useProjectStore((s) => s.clearGanttScroll);

  const project = derived.project;
  const zoomConfig = ZOOM_CONFIGS[view.zoom];
  // Effective day width = preset × fine-zoom scale (Ctrl+Wheel).
  const effectiveDayWidth = zoomConfig.dayWidth * view.dayWidthScale;
  const zoom = { ...zoomConfig, dayWidth: effectiveDayWidth };

  const visibleTasks = useVisibleTasks();
  const rows = useMemo(() => buildVisibleRows(visibleTasks), [visibleTasks]);
  const rowIndex = useMemo(() => rowIndexMap(rows), [rows]);
  const timeline = useMemo(
    () => buildTimeline(visibleTasks, project.startDate, effectiveDayWidth),
    [visibleTasks, project.startDate, effectiveDayWidth],
  );

  const taskGroupColor = useMemo<Map<TaskId, string>>(() => {
    const map = new Map<TaskId, string>();
    for (const g of project.viewGroups) {
      for (const tid of g.taskIds) {
        if (!map.has(tid)) map.set(tid, g.color);
      }
    }
    return map;
  }, [project.viewGroups]);

  const taskAssigneeColor = useMemo<Map<TaskId, string>>(() => {
    const map = new Map<TaskId, string>();
    for (const task of project.tasks) {
      if (task.assigneeIds.length > 0) {
        const assignee = project.resources.find((r) => r.id === task.assigneeIds[0]);
        if (assignee?.color) map.set(task.id, assignee.color);
      }
    }
    return map;
  }, [project.tasks, project.resources]);

  const baselineMap = useMemo<Map<TaskId, BaselineEntry> | null>(() => {
    if (!project.activeBaselineId) return null;
    const b = project.baselines.find((x) => x.id === project.activeBaselineId);
    if (!b) return null;
    return new Map(b.entries.map((e) => [e.taskId, e]));
  }, [project.activeBaselineId, project.baselines]);

  // --------------------------------------------------------------------------
  // Imperative helpers (DOM direct, no re-render)
  // --------------------------------------------------------------------------

  const setDomCursor = useCallback((cur: string) => {
    if (scrollerRef.current) scrollerRef.current.style.cursor = cur;
  }, []);

  /** Show/update the floating date tooltip near the cursor. */
  const showTooltip = useCallback((drag: DragState) => {
    const el = tooltipRef.current;
    if (!el || !drag.taskId || drag.deltaDays === 0) {
      if (el) el.style.display = 'none';
      return;
    }
    const task = useProjectStore.getState().derived.project.tasks.find((t) => t.id === drag.taskId);
    if (!task) { el.style.display = 'none'; return; }

    let line1 = '';
    let line2 = '';
    const sign = drag.deltaDays > 0 ? '+' : '';
    if (drag.mode === 'move') {
      const ns = addDaysISO(task.start, drag.deltaDays);
      const ne = addDaysISO(task.end, drag.deltaDays);
      line1 = `${ns} ~ ${ne}`;
      line2 = `${sign}${drag.deltaDays}일`;
    } else if (drag.mode === 'resize-start') {
      line1 = `시작: ${addDaysISO(task.start, drag.deltaDays)}`;
      line2 = `${sign}${drag.deltaDays}일`;
    } else if (drag.mode === 'resize-end') {
      line1 = `종료: ${addDaysISO(task.end, drag.deltaDays)}`;
      line2 = `${sign}${drag.deltaDays}일`;
    }

    el.innerHTML = `<span>${line1}</span><span class="opacity-60 ml-2">${line2}</span>`;
    el.style.left = `${drag.cursorX + 16}px`;
    el.style.top = `${Math.max(4, drag.cursorY - 42)}px`;
    el.style.display = 'flex';
  }, []);

  const hideTooltip = useCallback(() => {
    if (tooltipRef.current) tooltipRef.current.style.display = 'none';
  }, []);

  /** Briefly show an "undo hint" banner at the bottom of the panel. */
  const showToast = useCallback((msg: string) => {
    const el = toastRef.current;
    if (!el) return;
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    el.textContent = msg;
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
    el.style.display = 'block';
    toastTimerRef.current = setTimeout(() => {
      if (!toastRef.current) return;
      toastRef.current.style.opacity = '0';
      toastRef.current.style.transform = 'translateY(6px)';
      toastTimerRef.current = setTimeout(() => {
        if (toastRef.current) toastRef.current.style.display = 'none';
      }, 300);
    }, 2500);
  }, []);

  // --------------------------------------------------------------------------
  // Render model + draw
  // --------------------------------------------------------------------------

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
    const isMoving = (drag.mode === 'move' || drag.mode === 'resize-start' || drag.mode === 'resize-end')
      && drag.taskId != null && drag.deltaDays !== 0;
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
      showTodayLine: view.showTodayLine,
      showCritical: view.showCriticalPath,
      showBaseline: view.showBaseline,
      baseline: baselineMap,
      taskGroupColor,
      taskAssigneeColor,
      dragPreview: isMoving
        ? { taskId: drag.taskId!, deltaDays: drag.deltaDays, mode: drag.mode! }
        : null,
      selectedDepId: selectedDepIdRef.current,
      markers: project.markers ?? [],
    };
  }, [rows, timeline, zoom, derived.schedules, project, rowIndex, selected, view, baselineMap, taskGroupColor, taskAssigneeColor]);

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

    setCanvasSize(body, vw, vh, dpr);
    // Round to the nearest physical pixel to prevent sub-pixel GPU blurring.
    const rpx = (v: number) => Math.round(v * dpr) / dpr;
    body.style.transform = `translate(${rpx(sl)}px, ${rpx(st)}px)`;
    const bctx = body.getContext('2d')!;
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const model = buildModel();
    barsRef.current = renderGanttBody(bctx, model, vw, vh, sl, st);
    depHitboxesRef.current = computeDepHitboxes(model, sl, st);

    setCanvasSize(header, vw, HEADER_HEIGHT, dpr);
    const hctx = header.getContext('2d')!;
    hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderGanttHeader(hctx, model, vw, HEADER_HEIGHT, sl);

    // Rubber-band line while linking.
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

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [draw]);

  // Space = pan mode; update cursor immediately on press/release.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTextTarget(e.target)) {
        // Stop the browser's default page-scroll-down on Space.
        e.preventDefault();
        spaceHeldRef.current = true;
        if (!dragRef.current.mode) setDomCursor('grab');
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeldRef.current = false;
        if (!dragRef.current.mode) setDomCursor(panModeRef.current ? 'grab' : 'default');
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [setDomCursor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isTextTarget(e.target)) {
        const depId = selectedDepIdRef.current;
        if (depId) {
          e.preventDefault();
          useProjectStore.getState().removeDependency(depId);
          selectedDepIdRef.current = null;
          draw();
          showToast('의존성 삭제됨 · Ctrl+Z로 되돌리기');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draw, showToast]);

  const handleScroll = useCallback(() => {
    // Skip events triggered by our own programmatic scrollTop assignments.
    if (isSyncingRef.current) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    // Mark that the user (not a sync) drove this scroll so the sync effect
    // won't snap us back to a stale scrollTop while RAF throttle catches up.
    isUserScrollingRef.current = true;
    if (clearUserScrollTimer.current) clearTimeout(clearUserScrollTimer.current);
    clearUserScrollTimer.current = setTimeout(() => { isUserScrollingRef.current = false; }, 150);
    onScrollTopChange(scroller.scrollTop);
    draw();
  }, [draw, onScrollTopChange]);

  // Sync scrollTop prop → DOM (from DataGrid scroll events only).
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || Math.abs(scroller.scrollTop - scrollTop) <= 0.5) return;
    // If the user is actively scrolling this panel, the prop is stale (RAF lag).
    // Skip to avoid snapping back, which causes the visible oscillation.
    if (isUserScrollingRef.current) return;
    isSyncingRef.current = true;
    scroller.scrollTop = scrollTop;
    draw();
    requestAnimationFrame(() => { isSyncingRef.current = false; });
  }, [scrollTop, draw]);

  // Scroll gantt horizontally to show a requested date near the left edge.
  useEffect(() => {
    if (!ganttScrollTo) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const x = timeline.xFor(ganttScrollTo);
    // Offset by a small margin so the bar isn't flush with the edge.
    scroller.scrollLeft = Math.max(0, x - timeline.dayWidth * 2);
    draw();
    clearGanttScroll();
  }, [ganttScrollTo, timeline, draw, clearGanttScroll]);

  // --------------------------------------------------------------------------
  // Hit-test
  // --------------------------------------------------------------------------

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

  const hitTestDep = useCallback((x: number, y: number): string | null => {
    const TOLERANCE = 6;
    for (const hb of depHitboxesRef.current) {
      for (const [x1, y1, x2, y2] of hb.segments) {
        if (distToSegment(x, y, x1, y1, x2, y2) <= TOLERANCE) return hb.depId;
      }
    }
    return null;
  }, []);

  // --------------------------------------------------------------------------
  // Hover cursor (fires on every mousemove while not dragging)
  // --------------------------------------------------------------------------

  const onMouseMoveHover = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (dragRef.current.mode) return; // cursor managed by active drag
    if (spaceHeldRef.current || panModeRef.current) { setDomCursor('grab'); return; }
    const { bar, edge } = hitTest(e.clientX, e.clientY);

    // Bar hover memo tooltip
    const tip = barTipRef.current;
    if (tip) {
      if (bar) {
        const task = useProjectStore.getState().derived.project.tasks.find((t) => t.id === bar.taskId);
        const notes = task?.notes?.trim();
        if (notes) {
          const scroller = scrollerRef.current!;
          const rect = scroller.getBoundingClientRect();
          const cx = e.clientX - rect.left;
          const cy = e.clientY - rect.top;
          // Flip left when near right edge
          const tipW = Math.min(300, tip.scrollWidth || 240);
          const left = cx + tipW + 12 > scroller.clientWidth ? cx - tipW - 8 : cx + 12;
          tip.style.left = `${Math.max(4, left)}px`;
          tip.style.top  = `${Math.max(4, cy - 8)}px`;
          tip.style.display = 'block';
          tip.textContent = notes;
        } else {
          tip.style.display = 'none';
        }
      } else {
        tip.style.display = 'none';
      }
    }

    if (!bar) {
      setDomCursor('default');
    } else if (bar.isSummary) {
      setDomCursor('default');
    } else if (edge === 'resize-start' || edge === 'resize-end') {
      setDomCursor('ew-resize');
    } else {
      setDomCursor('grab');
    }
  }, [setDomCursor]);

  // --------------------------------------------------------------------------
  // Mouse down / drag / up
  // --------------------------------------------------------------------------

  const onMouseDown = (e: React.MouseEvent) => {
    const scroller = scrollerRef.current!;
    const store = useProjectStore.getState();
    const panning = spaceHeldRef.current || panModeRef.current || e.button === 1;

    if (panning) {
      dragRef.current = {
        ...NO_DRAG,
        mode: 'pan',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startScrollLeft: scroller.scrollLeft,
        startScrollTop: scroller.scrollTop,
      };
      setDomCursor('grabbing');
      e.preventDefault();
      window.addEventListener('mousemove', onWindowMove);
      window.addEventListener('mouseup', onWindowUp);
      return;
    }

    const { bar, edge } = hitTest(e.clientX, e.clientY);
    if (!bar) {
      const scRect = scroller.getBoundingClientRect();
      const depId = hitTestDep(e.clientX - scRect.left, e.clientY - scRect.top);
      if (depId) {
        selectedDepIdRef.current = depId;
        draw();
      } else {
        selectedDepIdRef.current = null;
        store.clearSelection();
      }
      return;
    }
    selectedDepIdRef.current = null;

    store.selectTask(bar.taskId, e.ctrlKey || e.metaKey);

    // Summary bars can only be selected; their dates are auto-calculated.
    if (bar.isSummary && !e.altKey) return;

    const mode: DragMode = e.altKey ? 'link' : edge;
    if (!mode) return;

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

    if (mode === 'link') {
      store.beginLink(bar.taskId);
      setDomCursor('crosshair');
    } else if (mode === 'move') {
      setDomCursor('grabbing');
    } else {
      setDomCursor('ew-resize');
    }

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

      const prevDelta = drag.deltaDays;
      drag.deltaDays = Math.round((e.clientX - drag.startClientX) / timeline.dayWidth);
      drag.cursorX = e.clientX - rect.left;
      drag.cursorY = e.clientY - rect.top;

      // Clamp resize-start so the bar can't shrink below 1 day.
      if (drag.mode === 'resize-start') {
        const task = useProjectStore.getState().derived.project.tasks.find((t) => t.id === drag.taskId);
        if (task) {
          const maxDelta = task.durationDays - 1;
          drag.deltaDays = Math.min(drag.deltaDays, maxDelta);
        }
      }

      if (drag.deltaDays !== prevDelta) draw();
      showTooltip(drag);
    },
    [draw, timeline.dayWidth, onScrollTopChange, showTooltip],
  );

  const onWindowUp = useCallback(
    (e: MouseEvent) => {
      const drag = dragRef.current;
      const store = useProjectStore.getState();

      hideTooltip();
      setDomCursor(panModeRef.current || spaceHeldRef.current ? 'grab' : 'default');

      if (drag.mode && drag.taskId) {
        if (drag.mode === 'move' && drag.deltaDays !== 0) {
          store.moveTaskBy(drag.taskId, drag.deltaDays);
          showToast('이동됨 · Ctrl+Z로 되돌리기');
        } else if (drag.mode === 'resize-start' && drag.deltaDays !== 0) {
          store.resizeTask(drag.taskId, 'start', drag.deltaDays);
          showToast('시작일 변경됨 · Ctrl+Z로 되돌리기');
        } else if (drag.mode === 'resize-end' && drag.deltaDays !== 0) {
          store.resizeTask(drag.taskId, 'end', drag.deltaDays);
          showToast('종료일 변경됨 · Ctrl+Z로 되돌리기');
        } else if (drag.mode === 'link') {
          const { bar } = hitTest(e.clientX, e.clientY);
          if (bar && bar.taskId !== drag.taskId) {
            const ok = store.addDependency(drag.taskId, bar.taskId, 'FS');
            if (ok) showToast('의존성 추가됨 · Ctrl+Z로 되돌리기');
          }
          store.beginLink(null);
        }
      }

      dragRef.current = NO_DRAG;
      window.removeEventListener('mousemove', onWindowMove);
      window.removeEventListener('mouseup', onWindowUp);
      draw();
    },
    [draw, onWindowMove, hideTooltip, showToast, setDomCursor],
  );

  const onDoubleClick = (e: React.MouseEvent) => {
    const { bar } = hitTest(e.clientX, e.clientY);
    if (bar) useProjectStore.getState().setInspecting(bar.taskId);
  };

  // Ctrl+Wheel: fine-zoom the day width without changing the level preset.
  // Registered as non-passive so preventDefault() actually works.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      useProjectStore.getState().scaleDayWidth(factor);
    };
    scroller.addEventListener('wheel', handler, { passive: false });
    return () => scroller.removeEventListener('wheel', handler);
  }, []);

  const contentHeight = rows.length * ROW_HEIGHT + SCROLL_BOTTOM_PADDING;

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col bg-surface">
      {/* Fixed header band */}
      <div className="relative shrink-0" style={{ height: HEADER_HEIGHT }}>
        <canvas ref={headerCanvasRef} className="block h-full w-full" />
      </div>

      {/* Scrolling body */}
      <div
        ref={scrollerRef}
        className="relative flex-1 overflow-auto"
        onScroll={handleScroll}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMoveHover}
        onMouseLeave={() => { if (barTipRef.current) barTipRef.current.style.display = 'none'; }}
        onDoubleClick={onDoubleClick}
        role="application"
        aria-label="간트 타임라인"
      >
        <div style={{ width: timeline.width, height: contentHeight }} />
        <canvas
          ref={bodyCanvasRef}
          className="pointer-events-none absolute left-0 top-0"
          style={{ willChange: 'transform', imageRendering: 'pixelated' }}
        />

        {/* Link-drag hint */}
        {linkSourceId && (
          <div className="pointer-events-none absolute left-2 top-2 rounded bg-accent px-2 py-1 text-2xs text-accent-fg">
            연결할 대상 작업으로 드래그하세요 (Alt+드래그)
          </div>
        )}

        {/* Bar hover memo tooltip */}
        <div
          ref={barTipRef}
          className="pointer-events-none absolute z-20 rounded-md border border-border bg-surface-2 px-2.5 py-2 text-xs shadow-lg text-content"
          style={{ display: 'none', maxWidth: 300, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}
        />

        {/* Drag date tooltip — updated via imperative DOM (no re-render) */}
        <div
          ref={tooltipRef}
          className="pointer-events-none absolute z-20 flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs shadow-lg text-content"
          style={{ display: 'none', whiteSpace: 'nowrap' }}
        />
      </div>

      {/* Zoom slider — bottom-right of the gantt area */}
      <div className="pointer-events-auto absolute bottom-4 right-4 z-20 flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-2xs shadow-sm">
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => {
            const next = !panModeRef.current;
            panModeRef.current = next;
            setPanMode(next);
            if (!dragRef.current.mode) setDomCursor(next ? 'grab' : 'default');
          }}
          className={`text-content-muted hover:text-content${panMode ? ' text-[rgb(var(--color-accent))]' : ''}`}
          title="이동 모드 (스페이스)"
        >
          <Hand size={12} />
        </button>
        <div className="mx-0.5 h-3 w-px bg-border" />
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => scaleDayWidth(1 / 1.2)}
          className="text-content-muted hover:text-content"
          title="축소"
        >
          <Minus size={12} />
        </button>
        <input
          type="range"
          min={0.25}
          max={4}
          step={0.05}
          value={view.dayWidthScale}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => setDayWidthScale(Number(e.target.value))}
          className="w-20 accent-[rgb(var(--color-accent))]"
          title="가로 비율 조정"
        />
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => scaleDayWidth(1.2)}
          className="text-content-muted hover:text-content"
          title="확대"
        >
          <Plus size={12} />
        </button>
        <span className="w-9 text-right tabular-nums text-content-muted">
          {Math.round(view.dayWidthScale * 100)}%
        </span>
      </div>

      {/* Undo toast — slides up from the bottom of the panel */}
      <div
        ref={toastRef}
        className="pointer-events-none absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full border border-border bg-surface-2 px-4 py-1.5 text-xs font-medium text-content shadow-xl"
        style={{
          display: 'none',
          opacity: 0,
          transform: 'translateY(6px)',
          transition: 'opacity 0.2s ease, transform 0.2s ease',
        }}
      />
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

function distToSegment(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
