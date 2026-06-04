import type { Project, TaskId, TaskSchedule, BaselineEntry } from '@/entities';
import { buildVisibleRows, rowIndexMap } from '@/features/grid/treeModel';
import { buildTimeline } from '@/features/gantt/timeline';
import { ZOOM_CONFIGS, type ZoomLevel } from '@/features/gantt/zoom';
import { readPalette } from '@/features/gantt/colors';
import { renderGanttBody, renderGanttHeader, type GanttRenderModel } from '@/features/gantt/renderGantt';
import { HEADER_HEIGHT, ROW_HEIGHT } from '@/features/gantt/layout';

/** Hard cap so we never allocate an un-drawable canvas. */
const MAX_DIM = 16000;
const NAME_COL_WIDTH = 240;

export interface FullRenderInput {
  project: Project;
  schedules: Map<TaskId, TaskSchedule>;
  zoom: ZoomLevel;
  theme: 'light' | 'dark';
  showCritical: boolean;
  showBaseline: boolean;
}

/**
 * Render the *entire* chart (task-name column + full timeline) to an offscreen
 * canvas for high-resolution PNG/PDF export. The export zoom auto-reduces if
 * the timeline would exceed the canvas size limit.
 */
export function renderFullCanvas(input: FullRenderInput): HTMLCanvasElement {
  const { project, schedules, theme, showCritical, showBaseline } = input;
  // Exports show the full plan — expand every collapsed parent.
  const rows = buildVisibleRows(project.tasks, { includeCollapsed: true });
  const rowIndex = rowIndexMap(rows);

  let dayWidth = ZOOM_CONFIGS[input.zoom].dayWidth;
  let timeline = buildTimeline(project.tasks, project.startDate, dayWidth);
  // Shrink day width until the timeline fits the canvas budget.
  while (timeline.width + NAME_COL_WIDTH > MAX_DIM && dayWidth > 0.2) {
    dayWidth *= 0.7;
    timeline = buildTimeline(project.tasks, project.startDate, dayWidth);
  }

  const contentHeight = Math.min(MAX_DIM - HEADER_HEIGHT, rows.length * ROW_HEIGHT);
  const totalW = Math.min(MAX_DIM, NAME_COL_WIDTH + timeline.width);
  const totalH = HEADER_HEIGHT + contentHeight;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(totalW * dpr);
  canvas.height = Math.floor(totalH * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const palette = readPalette(theme);
  const baseline = activeBaselineMap(project);

  const model: GanttRenderModel = {
    rows,
    timeline,
    zoom: { ...ZOOM_CONFIGS[input.zoom], dayWidth },
    palette,
    schedules,
    dependencies: project.dependencies,
    rowIndex,
    selected: new Set(),
    holidaySet: new Set(project.holidays.map((h) => h.date)),
    weekendDays: new Set([0, 6].filter((d) => !project.calendar.workingWeekdays.includes(d))),
    today: new Date().toISOString().slice(0, 10),
    showTodayLine: true,
    showCritical,
    showBaseline,
    baseline,
    taskGroupColor: buildTaskGroupColor(project),
    taskAssigneeColor: buildTaskAssigneeColor(project),
    dragPreview: null,
    markers: project.markers ?? [],
  };

  // Background.
  ctx.fillStyle = palette.surface;
  ctx.fillRect(0, 0, totalW, totalH);

  // Timeline area, offset right of the name column and below the header.
  ctx.save();
  ctx.translate(NAME_COL_WIDTH, HEADER_HEIGHT);
  renderGanttBody(ctx, model, timeline.width, contentHeight, 0, 0);
  ctx.restore();

  // Header band.
  ctx.save();
  ctx.translate(NAME_COL_WIDTH, 0);
  renderGanttHeader(ctx, model, timeline.width, HEADER_HEIGHT, 0);
  ctx.restore();

  // Name column.
  drawNameColumn(ctx, rows, palette, totalH);

  return canvas;
}

function drawNameColumn(
  ctx: CanvasRenderingContext2D,
  rows: ReturnType<typeof buildVisibleRows>,
  palette: ReturnType<typeof readPalette>,
  totalH: number,
): void {
  ctx.fillStyle = palette.surface2;
  ctx.fillRect(0, 0, NAME_COL_WIDTH, totalH);
  ctx.fillStyle = palette.text;
  ctx.font = '11px ui-sans-serif, system-ui';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = palette.grid;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const y = HEADER_HEIGHT + i * ROW_HEIGHT;
    if (y > totalH) break;
    ctx.fillStyle = row.hasChildren ? palette.text : palette.textMuted;
    const indent = 8 + row.depth * 12;
    ctx.fillText(`${row.wbs}  ${row.task.name}`, indent, y + ROW_HEIGHT / 2, NAME_COL_WIDTH - indent - 4);
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(NAME_COL_WIDTH, y + 0.5);
    ctx.stroke();
  }
  // Right border of the name column.
  ctx.strokeStyle = palette.gridStrong;
  ctx.beginPath();
  ctx.moveTo(NAME_COL_WIDTH - 0.5, 0);
  ctx.lineTo(NAME_COL_WIDTH - 0.5, totalH);
  ctx.stroke();
}

function buildTaskGroupColor(project: Project): Map<TaskId, string> {
  const map = new Map<TaskId, string>();
  for (const g of project.viewGroups) {
    for (const tid of g.taskIds) {
      if (!map.has(tid)) map.set(tid, g.color);
    }
  }
  return map;
}

function buildTaskAssigneeColor(project: Project): Map<TaskId, string> {
  const map = new Map<TaskId, string>();
  for (const task of project.tasks) {
    if (task.assigneeIds.length > 0) {
      const assignee = project.resources.find((r) => r.id === task.assigneeIds[0]);
      if (assignee?.color) map.set(task.id, assignee.color);
    }
  }
  return map;
}

function activeBaselineMap(project: Project): Map<TaskId, BaselineEntry> | null {
  if (!project.activeBaselineId) return null;
  const b = project.baselines.find((x) => x.id === project.activeBaselineId);
  return b ? new Map(b.entries.map((e) => [e.taskId, e])) : null;
}
