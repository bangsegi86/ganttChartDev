import type { Dependency, TaskId, TaskSchedule, BaselineEntry } from '@/entities';
import { addDaysISO, toDate, weekdayOf, type ISODate } from '@/shared/date/dateUtils';
import { Timeline } from './timeline';
import { BAR_HEIGHT, BAR_VPAD, ROW_HEIGHT } from './layout';
import { PRIORITY_COLORS, type CanvasPalette } from './colors';
import type { VisibleRow } from '@/features/grid/treeModel';
import type { ZoomConfig } from './zoom';
import { format } from 'date-fns';

/** Everything the body renderer needs for a single frame. */
export interface GanttRenderModel {
  rows: VisibleRow[];
  timeline: Timeline;
  zoom: ZoomConfig;
  palette: CanvasPalette;
  schedules: Map<TaskId, TaskSchedule>;
  dependencies: Dependency[];
  rowIndex: Map<TaskId, number>;
  selected: Set<TaskId>;
  holidaySet: Set<string>;
  weekendDays: Set<number>;
  today: ISODate;
  showCritical: boolean;
  showBaseline: boolean;
  baseline: Map<TaskId, BaselineEntry> | null;
  /** First view-group color for each task (group color overrides priority color). */
  taskGroupColor: Map<TaskId, string>;
  /** Live drag preview: which task is being dragged and by how many days. */
  dragPreview: { taskId: TaskId; deltaDays: number; mode: string } | null;
  /** Currently selected dependency id (for highlight). */
  selectedDepId?: string | null;
}

/** Geometry of a rendered bar; cached for hit-testing. */
export interface BarRect {
  taskId: TaskId;
  x: number;
  y: number;
  w: number;
  h: number;
  isMilestone: boolean;
  isSummary: boolean;
}

/** Line segments of a rendered dependency arrow; cached for hit-testing. */
export interface DepHitbox {
  depId: string;
  /** Each tuple is [x1, y1, x2, y2] in canvas (viewport) coordinates. */
  segments: Array<[number, number, number, number]>;
}

/**
 * Pure canvas painter for the gantt body. Draws only the rows/columns visible
 * in the [scrollLeft, scrollTop] viewport — this is what keeps 10k+ tasks
 * smooth. Returns the bar rectangles so the React layer can hit-test pointer
 * events without re-deriving geometry.
 */
export function renderGanttBody(
  ctx: CanvasRenderingContext2D,
  model: GanttRenderModel,
  viewportW: number,
  viewportH: number,
  scrollLeft: number,
  scrollTop: number,
): BarRect[] {
  const { palette, rows } = model;
  ctx.clearRect(0, 0, viewportW, viewportH);
  ctx.fillStyle = palette.surface;
  ctx.fillRect(0, 0, viewportW, viewportH);

  drawColumnShading(ctx, model, viewportW, viewportH, scrollLeft);
  drawGridLines(ctx, model, viewportW, viewportH, scrollLeft, scrollTop);
  drawTodayLine(ctx, model, viewportH, scrollLeft);

  // Visible row window.
  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 1);
  const lastRow = Math.min(rows.length - 1, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + 1);

  const bars: BarRect[] = [];
  for (let i = firstRow; i <= lastRow; i++) {
    const row = rows[i];
    if (!row) continue;
    const rect = drawBar(ctx, model, row, scrollLeft, scrollTop);
    if (rect) bars.push(rect);
  }

  drawDependencies(ctx, model, scrollLeft, scrollTop, firstRow, lastRow);
  return bars;
}

/** Weekend + holiday column shading (only at fine zooms for performance). */
function drawColumnShading(
  ctx: CanvasRenderingContext2D,
  model: GanttRenderModel,
  viewportW: number,
  viewportH: number,
  scrollLeft: number,
): void {
  const { timeline, palette, weekendDays, holidaySet } = model;
  if (timeline.dayWidth < 4) return; // too dense to be useful
  for (const { iso, x } of timeline.daysBetweenPixels(scrollLeft, scrollLeft + viewportW)) {
    const screenX = x - scrollLeft;
    const isHoliday = holidaySet.has(iso);
    const isWeekend = weekendDays.has(weekdayOf(iso));
    if (!isHoliday && !isWeekend) continue;
    ctx.fillStyle = isHoliday ? palette.holiday : palette.weekend;
    ctx.fillRect(screenX, 0, timeline.dayWidth, viewportH);
  }
}

/** Vertical (time) + horizontal (row) grid lines. */
function drawGridLines(
  ctx: CanvasRenderingContext2D,
  model: GanttRenderModel,
  viewportW: number,
  viewportH: number,
  scrollLeft: number,
  scrollTop: number,
): void {
  const { timeline, palette } = model;
  ctx.lineWidth = 1;

  // Horizontal row separators.
  ctx.strokeStyle = palette.grid;
  ctx.beginPath();
  const firstRow = Math.floor(scrollTop / ROW_HEIGHT);
  const lastRow = Math.ceil((scrollTop + viewportH) / ROW_HEIGHT);
  for (let r = firstRow; r <= lastRow; r++) {
    const y = Math.floor(r * ROW_HEIGHT - scrollTop) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(viewportW, y);
  }
  ctx.stroke();

  // Vertical time separators; emphasise month/week boundaries.
  const showEachDay = timeline.dayWidth >= 14;
  for (const { iso, x } of timeline.daysBetweenPixels(scrollLeft, scrollLeft + viewportW)) {
    const d = toDate(iso);
    const isMonthStart = d.getDate() === 1;
    const isWeekStart = d.getDay() === 1;
    if (!showEachDay && !isMonthStart && !isWeekStart) continue;
    const screenX = Math.floor(x - scrollLeft) + 0.5;
    ctx.strokeStyle = isMonthStart ? palette.gridStrong : palette.grid;
    ctx.beginPath();
    ctx.moveTo(screenX, 0);
    ctx.lineTo(screenX, viewportH);
    ctx.stroke();
  }
}

/** Vertical "today" marker. */
function drawTodayLine(
  ctx: CanvasRenderingContext2D,
  model: GanttRenderModel,
  viewportH: number,
  scrollLeft: number,
): void {
  const { timeline, palette, today } = model;
  if (today < timeline.start || today > timeline.end) return;
  const x = timeline.xFor(today) + timeline.dayWidth / 2 - scrollLeft;
  ctx.strokeStyle = palette.today;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, viewportH);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Draw a single task/summary/milestone bar and return its geometry. */
function drawBar(
  ctx: CanvasRenderingContext2D,
  model: GanttRenderModel,
  row: VisibleRow,
  scrollLeft: number,
  scrollTop: number,
): BarRect | null {
  const { timeline, palette, schedules, selected, showCritical, baseline, showBaseline, taskGroupColor, dragPreview } = model;
  const t = row.task;
  const y = row.index * ROW_HEIGHT - scrollTop;
  const x = timeline.xFor(t.start) - scrollLeft;
  const isSummary = row.hasChildren;
  const critical = showCritical && (schedules.get(t.id)?.isCritical ?? false);
  const cancelled = t.cancelled ?? false;

  // Baseline ghost bar (drawn behind the live bar).
  if (showBaseline && baseline) {
    const b = baseline.get(t.id);
    if (b) {
      const bx = timeline.xFor(b.start) - scrollLeft;
      const bw = (durationPx(timeline, b.start, b.end)) || timeline.dayWidth;
      ctx.fillStyle = palette.baseline;
      ctx.fillRect(bx, y + ROW_HEIGHT - 6, bw, 4);
    }
  }

  if (t.isMilestone) {
    const cx = x + timeline.dayWidth / 2;
    const cy = y + ROW_HEIGHT / 2;
    const r = BAR_HEIGHT / 2;
    if (cancelled) { ctx.save(); ctx.globalAlpha = 0.4; }
    ctx.fillStyle = cancelled ? palette.textMuted : (critical ? palette.critical : '#8b5cf6');
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
    if (cancelled) {
      ctx.restore();
      ctx.strokeStyle = palette.textMuted;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx + r, cy);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (selected.has(t.id)) strokeSelection(ctx, cx - r, cy - r, r * 2, r * 2, palette);
    return { taskId: t.id, x: cx - r, y: cy - r, w: r * 2, h: r * 2, isMilestone: true, isSummary };
  }

  const w = Math.max(timeline.dayWidth, durationPx(timeline, t.start, t.end));
  const barY = y + BAR_VPAD;

  // Draw the bar at reduced opacity when cancelled.
  if (cancelled) { ctx.save(); ctx.globalAlpha = 0.45; }

  if (isSummary) {
    // Summary bracket bar.
    ctx.fillStyle = cancelled ? palette.textMuted : palette.text;
    ctx.fillRect(x, barY + 4, w, BAR_HEIGHT - 8);
    ctx.fillRect(x, barY, 3, BAR_HEIGHT);
    ctx.fillRect(x + w - 3, barY, 3, BAR_HEIGHT);
  } else {
    const base = cancelled
      ? '#9ca3af' // gray-400 for cancelled tasks
      : t.color ?? taskGroupColor.get(t.id) ?? (critical ? palette.critical : PRIORITY_COLORS[t.priority]);
    roundRect(ctx, x, barY, w, BAR_HEIGHT, 4);
    ctx.fillStyle = base;
    ctx.fill();
    // Progress overlay (skip for cancelled).
    if (!cancelled && t.progress > 0) {
      const pw = (w * Math.min(100, t.progress)) / 100;
      ctx.save();
      roundRect(ctx, x, barY, w, BAR_HEIGHT, 4);
      ctx.clip();
      ctx.fillStyle = palette.progress;
      ctx.fillRect(x, barY, pw, BAR_HEIGHT);
      ctx.restore();
    }
    if (!cancelled && critical) {
      ctx.strokeStyle = palette.critical;
      ctx.lineWidth = 1.5;
      roundRect(ctx, x, barY, w, BAR_HEIGHT, 4);
      ctx.stroke();
    }
  }

  if (cancelled) ctx.restore();

  // Strikethrough line for cancelled tasks.
  if (cancelled) {
    ctx.save();
    ctx.strokeStyle = palette.textMuted;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(x, barY + BAR_HEIGHT / 2);
    ctx.lineTo(x + w, barY + BAR_HEIGHT / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Label drawn to the right of the bar when there is room.
  if (timeline.dayWidth >= 6) {
    ctx.fillStyle = palette.textMuted;
    ctx.font = '11px ui-sans-serif, system-ui';
    ctx.textBaseline = 'middle';
    ctx.fillText(t.name, x + w + 6, y + ROW_HEIGHT / 2, 240);
  }

  // Delta label while dragging: "+3일" badge centred on the bar.
  if (!isSummary && dragPreview?.taskId === t.id && dragPreview.deltaDays !== 0) {
    const sign = dragPreview.deltaDays > 0 ? '+' : '';
    const badge = `${sign}${dragPreview.deltaDays}일`;
    ctx.font = 'bold 10px ui-sans-serif, system-ui';
    const bw = Math.min(w - 4, ctx.measureText(badge).width + 10);
    const bx = x + w / 2 - bw / 2;
    const by = barY + 1;
    const bh = BAR_HEIGHT - 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, bx, by, bw, bh, 3);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(badge, bx + bw / 2 - ctx.measureText(badge).width / 2, by + bh / 2);
  }

  if (selected.has(t.id)) strokeSelection(ctx, x, barY, w, BAR_HEIGHT, palette);
  return { taskId: t.id, x, y: barY, w, h: BAR_HEIGHT, isMilestone: false, isSummary };
}

/** Dependency arrows between visible bars. */
function drawDependencies(
  ctx: CanvasRenderingContext2D,
  model: GanttRenderModel,
  scrollLeft: number,
  scrollTop: number,
  firstRow: number,
  lastRow: number,
): void {
  const { dependencies, rowIndex, timeline, palette, rows, schedules, showCritical, selectedDepId } = model;

  const paintDep = (dep: Dependency, highlight: boolean) => {
    const fi = rowIndex.get(dep.fromId);
    const ti = rowIndex.get(dep.toId);
    if (fi === undefined || ti === undefined) return;
    if (Math.max(fi, ti) < firstRow - 2 || Math.min(fi, ti) > lastRow + 2) return;
    const from = rows[fi]!.task;
    const to = rows[ti]!.task;

    const fromEndX = timeline.xFor(from.end) + timeline.dayWidth - scrollLeft;
    const fromStartX = timeline.xFor(from.start) - scrollLeft;
    const toStartX = timeline.xFor(to.start) - scrollLeft;
    const toEndX = timeline.xFor(to.end) + timeline.dayWidth - scrollLeft;
    const fromY = fi * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2;
    const toY = ti * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2;

    let sx = fromEndX;
    let tx = toStartX;
    if (dep.type === 'SS') { sx = fromStartX; tx = toStartX; }
    else if (dep.type === 'FF') { sx = fromEndX; tx = toEndX; }
    else if (dep.type === 'SF') { sx = fromStartX; tx = toEndX; }

    const onCritical =
      showCritical &&
      (schedules.get(dep.fromId)?.isCritical ?? false) &&
      (schedules.get(dep.toId)?.isCritical ?? false);

    if (highlight) {
      ctx.strokeStyle = palette.today;
      ctx.lineWidth = 2.5;
    } else {
      ctx.strokeStyle = onCritical ? palette.critical : palette.link;
      ctx.lineWidth = 1.5;
    }
    drawElbow(ctx, sx, fromY, tx, toY, dep.type);
    drawArrowHead(ctx, tx, toY, dep.type === 'FF' || dep.type === 'SF' ? -1 : 1, ctx.strokeStyle);
  };

  // Non-selected deps first, selected on top so it isn't obscured.
  for (const dep of dependencies) {
    if (dep.id !== selectedDepId) paintDep(dep, false);
  }
  if (selectedDepId) {
    const sel = dependencies.find((d) => d.id === selectedDepId);
    if (sel) paintDep(sel, true);
  }
}

// --- drawing primitives ------------------------------------------------------

/**
 * Returns the three elbow line segments for a dependency arrow in canvas
 * (viewport) coordinates. Used by both the canvas painter and the hit-tester.
 */
function elbowSegments(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  type: string,
): Array<[number, number, number, number]> {
  const gap = 10;
  if (type === 'FS') {
    const midX = Math.max(sx + gap, tx - gap);
    return [[sx, sy, midX, sy], [midX, sy, midX, ty], [midX, ty, tx, ty]];
  }
  const offsetX = sx + (type === 'SS' ? -gap : gap);
  return [[sx, sy, offsetX, sy], [offsetX, sy, offsetX, ty], [offsetX, ty, tx, ty]];
}

/**
 * Compute hit-test geometry for all dependency arrows in the current frame.
 * Must be called with the same model/scroll values that were passed to
 * renderGanttBody so that coordinates match.
 */
export function computeDepHitboxes(
  model: GanttRenderModel,
  scrollLeft: number,
  scrollTop: number,
): DepHitbox[] {
  const { dependencies, rowIndex, timeline, rows } = model;
  const hitboxes: DepHitbox[] = [];
  for (const dep of dependencies) {
    const fi = rowIndex.get(dep.fromId);
    const ti = rowIndex.get(dep.toId);
    if (fi === undefined || ti === undefined) continue;
    const from = rows[fi]!.task;
    const to = rows[ti]!.task;

    const fromEndX = timeline.xFor(from.end) + timeline.dayWidth - scrollLeft;
    const fromStartX = timeline.xFor(from.start) - scrollLeft;
    const toStartX = timeline.xFor(to.start) - scrollLeft;
    const toEndX = timeline.xFor(to.end) + timeline.dayWidth - scrollLeft;
    const fromY = fi * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2;
    const toY = ti * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2;

    let sx = fromEndX;
    let tx = toStartX;
    if (dep.type === 'SS') { sx = fromStartX; tx = toStartX; }
    else if (dep.type === 'FF') { sx = fromEndX; tx = toEndX; }
    else if (dep.type === 'SF') { sx = fromStartX; tx = toEndX; }

    hitboxes.push({ depId: dep.id, segments: elbowSegments(sx, fromY, tx, toY, dep.type) });
  }
  return hitboxes;
}

function durationPx(timeline: Timeline, start: ISODate, end: ISODate): number {
  return (timeline.xFor(end) + timeline.dayWidth) - timeline.xFor(start);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function strokeSelection(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  palette: CanvasPalette,
): void {
  ctx.strokeStyle = palette.today;
  ctx.lineWidth = 2;
  ctx.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
}

function drawElbow(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  type: string,
): void {
  const segs = elbowSegments(sx, sy, tx, ty, type);
  ctx.beginPath();
  ctx.moveTo(segs[0]![0], segs[0]![1]);
  for (const [x1, y1, x2, y2] of segs) {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dir: number,
  color: string,
): void {
  const size = 4;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - dir * size, y - size);
  ctx.lineTo(x - dir * size, y + size);
  ctx.closePath();
  ctx.fill();
}

// --- header ------------------------------------------------------------------

/** Paint the sticky two-band time header. */
export function renderGanttHeader(
  ctx: CanvasRenderingContext2D,
  model: Pick<GanttRenderModel, 'timeline' | 'zoom' | 'palette'>,
  viewportW: number,
  headerH: number,
  scrollLeft: number,
): void {
  const { timeline, palette, zoom } = model;
  ctx.clearRect(0, 0, viewportW, headerH);
  ctx.fillStyle = palette.surface2;
  ctx.fillRect(0, 0, viewportW, headerH);
  ctx.strokeStyle = palette.gridStrong;
  ctx.beginPath();
  ctx.moveTo(0, headerH - 0.5);
  ctx.lineTo(viewportW, headerH - 0.5);
  ctx.moveTo(0, headerH / 2 - 0.5);
  ctx.lineTo(viewportW, headerH / 2 - 0.5);
  ctx.stroke();

  ctx.textBaseline = 'middle';
  ctx.fillStyle = palette.text;

  // Minor band (bottom).
  ctx.font = '10px ui-sans-serif, system-ui';
  let lastMajorKey = '';
  for (const { iso, x } of timeline.daysBetweenPixels(scrollLeft, scrollLeft + viewportW)) {
    const screenX = x - scrollLeft;
    const d = toDate(iso);
    const minorLabel = minorTickLabel(zoom, d);
    if (minorLabel) {
      ctx.fillStyle = palette.textMuted;
      ctx.fillText(minorLabel, screenX + 3, (headerH * 3) / 4);
      ctx.strokeStyle = palette.grid;
      ctx.beginPath();
      ctx.moveTo(screenX + 0.5, headerH / 2);
      ctx.lineTo(screenX + 0.5, headerH);
      ctx.stroke();
    }
    // Major band (top).
    const majorKey = majorTickKey(zoom, d);
    if (majorKey && majorKey !== lastMajorKey) {
      lastMajorKey = majorKey;
      ctx.fillStyle = palette.text;
      ctx.font = '11px ui-sans-serif, system-ui';
      ctx.fillText(majorKey, screenX + 4, headerH / 4);
      ctx.font = '10px ui-sans-serif, system-ui';
      ctx.strokeStyle = palette.gridStrong;
      ctx.beginPath();
      ctx.moveTo(screenX + 0.5, 0);
      ctx.lineTo(screenX + 0.5, headerH / 2);
      ctx.stroke();
    }
  }
}

function minorTickLabel(zoom: ZoomConfig, d: Date): string | null {
  switch (zoom.minor) {
    case 'hour':
      return format(d, 'd일');
    case 'day':
      return format(d, 'd');
    case 'week':
      return d.getDay() === 1 ? format(d, 'd') : null;
    case 'month':
      return d.getDate() === 1 ? format(d, 'M월') : null;
    default:
      return null;
  }
}

function majorTickKey(zoom: ZoomConfig, d: Date): string | null {
  switch (zoom.major) {
    case 'day':
      return format(d, 'M월 d일 (eee)');
    case 'week':
      return d.getDay() === 1 ? `${format(d, 'M월')} ${weekOfMonth(d)}주` : null;
    case 'month':
      return d.getDate() === 1 ? format(d, 'yyyy년 M월') : null;
    case 'quarter':
      return d.getDate() === 1 && d.getMonth() % 3 === 0
        ? `${d.getFullYear()} Q${Math.floor(d.getMonth() / 3) + 1}`
        : null;
    case 'year':
      return d.getDate() === 1 && d.getMonth() === 0 ? `${d.getFullYear()}년` : null;
    default:
      return null;
  }
}

function weekOfMonth(d: Date): number {
  return Math.ceil((d.getDate() + 6 - d.getDay()) / 7);
}

/** Helper used by the React layer for snapping a pixel delta to whole days. */
export function snapDaysFromPixels(timeline: Timeline, dxPixels: number): number {
  return timeline.daysForPixels(dxPixels);
}

/** Compute the next day for header iteration (kept for completeness/tests). */
export function nextDay(iso: ISODate): ISODate {
  return addDaysISO(iso, 1);
}
