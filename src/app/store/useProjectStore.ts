import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type {
  Baseline,
  ChartMarker,
  Dependency,
  DependencyType,
  Holiday,
  Project,
  Resource,
  Task,
  TaskId,
  WorkCalendar,
} from '@/entities';
import type { FilterMode } from '@/features/view/viewFilter';
import { recalc, type DerivedSchedule } from './recalc';
import { shareProject } from './structuralShare';
import { normalizeProject } from './normalizeProject';
import { buildVisibleRows } from '@/features/grid/treeModel';
import { formatDayKo, parseDateInput } from '@/shared/date/parseDateInput';
import { WorkingCalendar } from '@/services/scheduler/workCalendar';
import { wouldCreateCycle } from '@/services/dependency/graph';
import { autosaveRepository } from '@/services/persistence/projectRepository';
import { bridge } from '@/shared/bridge';
import { addDaysISO, diffDaysISO, todayISO } from '@/shared/date/dateUtils';
import type { ZoomLevel } from '@/features/gantt/zoom';
import { stepZoom } from '@/features/gantt/zoom';
import { DEFAULT_ROW_HEIGHT } from '@/features/gantt/layout';

const HISTORY_LIMIT = 100; // ≥100 undo steps as required.
const AUTOSAVE_INTERVAL_MS = 60_000; // 1-minute autosave.

export type ThemeMode = 'light' | 'dark';
export type ActiveView = 'gantt' | 'resources' | 'calendar' | 'groups';

interface ViewState {
  theme: ThemeMode;
  zoom: ZoomLevel;
  showCriticalPath: boolean;
  showBaseline: boolean;
  showTodayLine: boolean;
  /** Left grid pane width in pixels (resizable split). */
  gridWidth: number;
  /** Whether the left grid panel is collapsed to a thin strip. */
  gridCollapsed: boolean;
  activeView: ActiveView;
  /** Display filter: show all tasks, a view group, or a focused selection. */
  filterMode: FilterMode;
  /** Active view group id when `filterMode === 'group'`. */
  filterGroupId: string | null;
  /** Snapshot of task ids shown when `filterMode === 'focus'`. */
  focusIds: TaskId[];
  /** Resource ids to show when `filterMode === 'assignee'`. */
  filterAssigneeIds: string[];
  /** Fine zoom multiplier applied on top of the preset day-width (Ctrl+Wheel). */
  dayWidthScale: number;
  /** Pixel height of each task row. Controls the vertical spacing between bars. */
  rowHeight: number;
  /** Task-name search text. Applied to grid AND gantt so their rows stay aligned. */
  nameFilter: string;
  /**
   * One-shot scroll request for the gantt: when non-null the GanttChart will
   * scroll so this ISO date is near the left edge of the viewport, then clear
   * the field back to null.
   */
  ganttScrollTo: string | null;
  /** App-level notification toast. Cleared automatically by the App shell after display. */
  appToast: { msg: string; type: 'success' | 'error' | 'info'; id: number } | null;
}

interface ProjectStore {
  // --- document + derived analysis ---
  derived: DerivedSchedule;
  project: Project; // convenience alias = derived.project
  // --- history ---
  past: Project[];
  future: Project[];
  // --- selection / interaction ---
  selectedTaskIds: Set<TaskId>;
  editingTaskId: TaskId | null;
  /** Task whose full details are open in the inspector, if any. */
  inspectingTaskId: TaskId | null;
  linkSourceId: TaskId | null; // task currently being linked by drag
  /** True when all selected tasks are already cancelled and awaiting hard-delete confirmation. */
  confirmDeletePending: boolean;
  // --- view ---
  view: ViewState;
  dirty: boolean;
  recoveryAvailable: boolean;
  /** Absolute file path of the currently open file, null if unsaved. */
  currentFilePath: string | null;

  // --- lifecycle ---
  loadProject: (project: Project) => void;
  newProject: (name?: string) => void;
  renameProject: (name: string) => void;
  saveProject: () => Promise<void>;
  saveAsProject: () => Promise<void>;
  flushAutosave: () => Promise<void>;
  shareExport: () => Promise<void>;
  shareImport: () => Promise<void>;

  // --- task mutations ---
  updateTask: (id: TaskId, patch: Partial<Task>) => void;
  addTask: (afterId?: TaskId) => void;
  /** Insert a new task immediately *before* the given sibling. */
  addTaskBefore: (beforeId: TaskId) => void;
  deleteSelected: () => void;
  hardDeleteSelected: () => void;
  uncancelSelected: () => void;
  cancelConfirmDelete: () => void;
  toggleCollapse: (id: TaskId) => void;
  /** Set every parent task's collapsed flag to false. */
  expandAll: () => void;
  /** Set every parent task's collapsed flag to true. */
  collapseAll: () => void;
  indentTask: (id: TaskId) => void;
  outdentTask: (id: TaskId) => void;
  moveTaskBy: (id: TaskId, deltaDays: number) => void;
  resizeTask: (id: TaskId, edge: 'start' | 'end', deltaDays: number) => void;
  moveTaskUp: (id: TaskId) => void;
  moveTaskDown: (id: TaskId) => void;
  /** Move draggedId immediately before targetId in the sibling order. */
  moveTaskBefore: (draggedId: TaskId, targetId: TaskId) => void;
  /**
   * Reparent one or more tasks (with their whole subtrees) under `newParentId`
   * (null = root level). When `afterId` is a child of the new parent the moved
   * block is inserted right after it; otherwise it is appended at the end.
   * Cut items nested inside another cut item are skipped (they ride along with
   * their ancestor). Moving a task into itself or its own descendant is a no-op.
   * This is what powers the right-click 잘라내기 → 붙여넣기 reparent flow.
   */
  moveTasks: (taskIds: TaskId[], newParentId: TaskId | null, afterId: TaskId | null) => string | null;
  duplicateSelected: () => void;
  /**
   * Duplicate tasks with their whole subtrees (and the links inside them).
   * Nested picks ride along with their selected ancestor. Each copy is placed
   * right below its original. Returns the new top-level ids.
   */
  duplicateTasks: (ids: TaskId[]) => TaskId[];
  /** Deep-clone a task and its entire subtree, inserting the copy right below the original. */
  duplicateTask: (id: TaskId) => void;
  /** Move a task and every descendant forward/back by the given number of days. */
  moveSubtreeBy: (id: TaskId, deltaDays: number) => void;
  /** Wrap the currently selected tasks in a newly created parent task. */
  groupSelectedTasks: () => void;
  /** Bulk-import tasks from clipboard TSV text (e.g. copied from Excel). */
  importTsvTasks: (text: string) => void;
  /**
   * Insert new tasks parsed from TSV as siblings immediately after `afterId`
   * (shifting later siblings down). When `afterId` is null they are appended at
   * the end of the root level. Returns the number of rows inserted.
   */
  insertTsvTasks: (afterId: TaskId | null, text: string) => number;
  /** Update existing tasks in-place from clipboard TSV (paste onto selection). */
  updateTasksFromTsv: (taskIds: string[], tsvText: string) => void;
  /**
   * Change a task's start or end from free text typed by the user. Parses and
   * validates the input, applies it (a new start moves the task and keeps its
   * duration) and shows a detailed notice when the input is rejected or the
   * schedule adjusts it. Returns false when nothing was changed.
   */
  editTaskDate: (id: TaskId, field: 'start' | 'end', raw: string) => boolean;
  /** Run several edits as ONE undo step (e.g. paste that updates and adds rows). */
  transact: (fn: () => void) => void;
  /**
   * Add `count` blank tasks under `parentId`, right after `afterId` (a child of
   * that parent) or at the end of its children. Returns the new ids in order.
   */
  appendBlankTasks: (parentId: TaskId | null, count: number, afterId?: TaskId | null) => TaskId[];
  /** Apply multiple patches in a single commit (one undo step). Used for range paste. */
  batchUpdateTasks: (updates: { id: TaskId; patch: Partial<Task> }[]) => void;

  // --- dependencies ---
  addDependency: (fromId: TaskId, toId: TaskId, type?: DependencyType) => boolean;
  updateDependency: (id: string, patch: Partial<Dependency>) => void;
  removeDependency: (id: string) => void;

  // --- resources / holidays / calendar ---
  upsertResource: (resource: Resource) => void;
  removeResource: (id: string) => void;
  upsertHoliday: (holiday: Holiday) => void;
  removeHoliday: (date: string) => void;
  setCalendar: (patch: Partial<WorkCalendar>) => void;

  // --- baselines ---
  captureBaseline: (name: string) => void;
  setActiveBaseline: (id: string | null) => void;
  removeBaseline: (id: string) => void;

  // --- view groups (보기 그룹) ---
  createViewGroup: (name: string, taskIds?: TaskId[]) => string;
  renameViewGroup: (id: string, name: string) => void;
  setViewGroupColor: (id: string, color: string) => void;
  removeViewGroup: (id: string) => void;
  addTasksToGroup: (groupId: string, taskIds: TaskId[]) => void;
  removeTasksFromGroup: (groupId: string, taskIds: TaskId[]) => void;

  // --- chart markers (세로 마커 선) ---
  addMarker: (marker: Omit<ChartMarker, 'id'>) => void;
  updateMarker: (id: string, patch: Partial<Omit<ChartMarker, 'id'>>) => void;
  removeMarker: (id: string) => void;

  // --- history ops ---
  undo: () => void;
  redo: () => void;

  // --- selection ---
  selectTask: (id: TaskId, additive?: boolean) => void;
  setSelectedTaskIds: (ids: Set<TaskId>) => void;
  clearSelection: () => void;
  setEditing: (id: TaskId | null) => void;
  setInspecting: (id: TaskId | null) => void;
  beginLink: (id: TaskId | null) => void;

  // --- view ops ---
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setZoom: (zoom: ZoomLevel) => void;
  zoomBy: (direction: 1 | -1) => void;
  toggleCriticalPath: () => void;
  toggleBaseline: () => void;
  toggleTodayLine: () => void;
  setGridWidth: (width: number) => void;
  toggleGridCollapse: () => void;
  setActiveView: (view: ActiveView) => void;
  /** Show all tasks, a specific view group, the current selection, or tasks by assignee. */
  setViewFilter: (mode: FilterMode, groupId?: string | null, assigneeIds?: string[]) => void;
  clearViewFilter: () => void;
  /** Multiply the fine-zoom dayWidth scale (Ctrl+Wheel). Clamped to [0.1, 10]. */
  scaleDayWidth: (factor: number) => void;
  /** Set the fine-zoom dayWidth scale directly. Clamped to [0.1, 10]. */
  setDayWidthScale: (scale: number) => void;
  /** Set the row height in pixels. Clamped to [20, 80]. */
  setRowHeight: (height: number) => void;
  /** Set the task-name search text shared by the grid and gantt. */
  setNameFilter: (text: string) => void;
  /**
   * Sort the direct children of the given task by their start date (ascending).
   * Sibling order values are reassigned; the subtrees themselves are untouched.
   */
  sortChildrenByStart: (parentId: TaskId) => void;
  /** Ask the GanttChart to scroll so `date` is visible near the left edge. */
  scrollGanttToDate: (date: string) => void;
  /** Called by GanttChart after it has consumed a scrollGanttToDate request. */
  clearGanttScroll: () => void;
  /** Show an app-level toast notification. Type defaults to 'error'. */
  showAppToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  clearAppToast: () => void;
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
/** Nesting depth of `transact()` and whether it already recorded an undo step. */
let txDepth = 0;
let txRecorded = false;

/** Build the initial empty document so the store always has a valid project. */
function emptyProject(): Project {
  return {
    schemaVersion: 1,
    id: nanoid(8),
    name: '새 프로젝트',
    startDate: todayISO(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    calendar: { workingWeekdays: [1, 2, 3, 4, 5], excludeHolidays: true, mode: 'working', hoursPerDay: 8 },
    tasks: [],
    dependencies: [],
    resources: [],
    holidays: [],
    baselines: [],
    activeBaselineId: null,
    viewGroups: [],
    markers: [],
  };
}

// ---------------------------------------------------------------------------
// TSV copy/paste helpers (used by importTsvTasks + updateTasksFromTsv)
// ---------------------------------------------------------------------------

const TSV_PRIORITY_MAP: Record<string, 'low' | 'medium' | 'high' | 'critical'> = {
  낮음: 'low', 보통: 'medium', 높음: 'high', 긴급: 'critical',
  low: 'low', medium: 'medium', high: 'high', critical: 'critical',
};

/**
 * Parse TSV clipboard text into data rows, automatically skipping a header
 * row if one is detected. Header detection: the second cell of the first row
 * is NOT an ISO date (e.g. "시작" header vs "2026-01-06" data).
 */
export function parseTsvDataRows(text: string): string[][] {
  const rows = text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split('\t').map((c) => c.trim()));
  if (rows.length === 0) return [];
  const second = rows[0]?.[1] ?? '';
  const hasHeader = second !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(second);
  return hasHeader ? rows.slice(1) : rows;
}

/**
 * Apply a user date edit the same way everywhere (grid typing, paste, bar drag
 * or resize): an edited start becomes a "start no earlier than" constraint —
 * the task stays where it was put but still follows predecessors that push it
 * later — and the start→end span becomes the working-day duration. Tasks the
 * user explicitly switched to manual scheduling keep their exact dates.
 */
function applyDateEdit(t: Task, cal: WorkingCalendar, startEdited: boolean, endEdited = !startEdited): void {
  if (startEdited && !endEdited) {
    // A new start MOVES the task: the duration is kept (it used to collapse to
    // one day when the new start passed the old end).
    t.end = t.isMilestone ? t.start : cal.finishDateFor(t.start, Math.max(1, t.durationDays));
  }
  if (t.end < t.start) t.end = t.start;
  if (t.isMilestone) t.end = t.start;
  if (!t.manuallyScheduled && startEdited) {
    t.constraint = 'snet';
    t.constraintDate = t.start;
  }
  if (endEdited || t.manuallyScheduled) {
    t.durationDays = t.isMilestone ? 0 : Math.max(1, cal.workingDaysBetween(t.start, t.end));
  }
}

/**
 * Parse a date cell from pasted rows leniently (same rules as typing). Records
 * a readable reason in `bad` for non-empty cells that are not dates.
 */
function lenientDay(raw: string | undefined, bad: string[], lineNo: number): string | undefined {
  if (!raw || !raw.trim()) return undefined;
  const r = parseDateInput(raw);
  if (r.ok) return r.iso;
  bad.push(`${lineNo}행: ${r.message}`);
  return undefined;
}

/** Tell the user which pasted date cells could not be read. */
function reportBadDates(bad: string[], show: (msg: string, type: 'error') => void): void {
  if (bad.length === 0) return;
  const more = bad.length > 3 ? `\n…그 밖에 ${bad.length - 3}칸` : '';
  show(`날짜 ${bad.length}칸을 알아볼 수 없어 비워 두었습니다(새 작업은 프로젝트 시작일로 넣음).\n${bad.slice(0, 3).join('\n')}${more}`, 'error');
}

/**
 * Of `ids`, keep only those with no selected ancestor (their subtrees come
 * along anyway), sorted by on-screen (tree) order.
 */
function topLevelInDisplayOrder(tasks: Task[], ids: Iterable<TaskId>): Task[] {
  const picked = new Set(ids);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const hasPickedAncestor = (t: Task): boolean => {
    let p = t.parentId ? byId.get(t.parentId) : undefined;
    const seen = new Set<TaskId>();
    while (p && !seen.has(p.id)) {
      if (picked.has(p.id)) return true;
      seen.add(p.id);
      p = p.parentId ? byId.get(p.parentId) : undefined;
    }
    return false;
  };
  const rank = new Map(buildVisibleRows(tasks, { includeCollapsed: true }).map((r, i) => [r.task.id, i]));
  return tasks
    .filter((t) => picked.has(t.id) && !hasPickedAncestor(t))
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
}

/**
 * Where a row inserted "right below `ref`" goes: the first child of an
 * expanded group, else the next sibling of `ref`, else the end of the root.
 */
function insertionPoint(tasks: Task[], ref: Task | undefined): { parentId: TaskId | null; insertOrder: number } {
  if (ref && !ref.collapsed && tasks.some((t) => t.parentId === ref.id)) {
    return { parentId: ref.id, insertOrder: -0.5 };
  }
  if (ref) return { parentId: ref.parentId, insertOrder: ref.order + 1 };
  const rootMax = tasks.filter((t) => t.parentId === null).reduce((m, t) => Math.max(m, t.order), -1);
  return { parentId: null, insertOrder: rootMax + 1 };
}

/** Every descendant id of `id` (not including `id`). */
function collectDescendants(tasks: Task[], id: TaskId): TaskId[] {
  const out: TaskId[] = [];
  const stack = [id];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const t of tasks) if (t.parentId === cur) { out.push(t.id); stack.push(t.id); }
  }
  return out;
}

function calendarOf(d: Project): WorkingCalendar {
  return new WorkingCalendar(d.calendar, d.holidays);
}

/** Task fields whose change can never move a date or the critical path. */
const COSMETIC_FIELDS = new Set<keyof Task>(['name', 'notes', 'color', 'priority', 'assigneeIds', 'collapsed']);

/** True when any patch touches a field the scheduler or CPM depends on. */
function affectsSchedule(patches: Partial<Task>[]): boolean {
  return patches.some((p) => Object.keys(p).some((k) => !COSMETIC_FIELDS.has(k as keyof Task)));
}

export const useProjectStore = create<ProjectStore>((set, get) => {
  const initialDerived = recalc(emptyProject());

  /**
   * Apply a pure mutation to a deep clone of the current project, re-solve the
   * schedule, push the previous state onto the undo stack, and schedule an
   * autosave. This is the single write path for all document edits.
   */
  function commit(
    mutator: (draft: Project) => void,
    opts: { reschedule?: boolean } = {},
  ): void {
    const state = get();
    const prev = state.derived.project;
    const draft: Project = structuredClone(prev);
    mutator(draft);
    // Edits that cannot move any date (name, notes, colour…) skip the full
    // schedule + CPM pass: the draft is a clone of an already-scheduled project.
    const solved: DerivedSchedule =
      opts.reschedule === false ? { ...state.derived, project: draft } : recalc(draft);
    // Re-use unchanged objects from the previous version (cheap undo history,
    // working React memoisation). A no-op edit leaves history untouched.
    const project = shareProject(prev, solved.project);
    if (project === prev) return;
    const derived: DerivedSchedule = { ...solved, project };
    // Inside `transact()` only the first edit records an undo step, so the
    // whole group of edits is undone together.
    const record = !(txDepth > 0 && txRecorded);
    if (txDepth > 0) txRecorded = true;
    const past = record ? [...state.past, prev].slice(-HISTORY_LIMIT) : state.past;
    set({ derived, project: derived.project, past, future: [], dirty: true });
    scheduleAutosave();
  }

  /**
   * Change only tasks' `collapsed` flags. Collapse state is a view concern: it
   * never affects the schedule, so it skips recalc, the undo history and the
   * dirty flag. Only the touched task objects are copied.
   */
  function setCollapsed(next: (t: Task) => boolean): void {
    const state = get();
    let changed = false;
    const tasks = state.derived.project.tasks.map((t) => {
      const c = next(t);
      if (c === t.collapsed) return t;
      changed = true;
      return { ...t, collapsed: c };
    });
    if (!changed) return;
    const project = { ...state.derived.project, tasks };
    set({ derived: { ...state.derived, project }, project });
  }

  /** Carry the current collapse state onto a history snapshot being restored. */
  function keepCollapse(target: Project): Project {
    const current = new Map(get().derived.project.tasks.map((t) => [t.id, t.collapsed]));
    return {
      ...target,
      tasks: target.tasks.map((t) => {
        const c = current.get(t.id);
        return c === undefined || c === t.collapsed ? t : { ...t, collapsed: c };
      }),
    };
  }

  /**
   * Stamp `updatedAt` before writing a file. Not a commit: saving must not add
   * an undo step, re-run the scheduler, or mark the document dirty.
   */
  function stampUpdatedAt(): void {
    const state = get();
    const project = { ...state.derived.project, updatedAt: new Date().toISOString() };
    set({ derived: { ...state.derived, project }, project });
  }

  /**
   * Throttled autosave: the first unsaved edit arms a timer and later edits do
   * not reset it, so continuous editing is still snapshotted at least once per
   * interval. (A debounce here meant nothing was saved while the user kept
   * editing more often than once a minute.)
   */
  function scheduleAutosave(): void {
    if (autosaveTimer) return;
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      void get().flushAutosave();
    }, AUTOSAVE_INTERVAL_MS);
  }

  return {
    derived: initialDerived,
    project: initialDerived.project,
    past: [],
    future: [],
    selectedTaskIds: new Set<TaskId>(),
    editingTaskId: null,
    inspectingTaskId: null,
    linkSourceId: null,
    confirmDeletePending: false,
    dirty: false,
    recoveryAvailable: false,
    currentFilePath: null,
    view: {
      theme: 'dark',
      zoom: 'day',
      showCriticalPath: true,
      showBaseline: false,
      gridCollapsed: false,
      showTodayLine: true,
      gridWidth: 460,
      activeView: 'gantt',
      filterMode: 'all',
      filterGroupId: null,
      focusIds: [],
      filterAssigneeIds: [],
      dayWidthScale: 1.0,
      rowHeight: DEFAULT_ROW_HEIGHT,
      nameFilter: '',
      ganttScrollTo: null,
      appToast: null,
    },

    newProject(name) {
      const p = emptyProject();
      if (name?.trim()) p.name = name.trim();
      get().loadProject(p);
    },

    renameProject(name) {
      commit((d) => { d.name = name.trim() || d.name; });
    },

    loadProject(project) {
      // Repair missing/invalid fields so hand-edited or older files cannot crash rendering.
      const derived = recalc(normalizeProject(project));
      set((s) => ({
        derived,
        project: derived.project,
        past: [],
        future: [],
        selectedTaskIds: new Set(),
        dirty: false,
        currentFilePath: null,
        view: { ...s.view, filterMode: 'all', filterGroupId: null, focusIds: [] },
      }));
    },

    async saveProject() {
      try {
        stampUpdatedAt();
        const project = get().derived.project;
        const json = JSON.stringify(project, null, 2);
        const fp = get().currentFilePath;
        if (fp) {
          const res = await bridge().project.saveToPath(fp, json);
          if (res.ok) {
            await autosaveRepository.clear();
            set({ dirty: false });
            get().showAppToast('저장되었습니다.', 'success');
          } else {
            get().showAppToast('저장에 실패했습니다. 디스크 공간 또는 파일 권한을 확인하세요.', 'error');
          }
        } else {
          const res = await bridge().project.exportFile(project.name || '간트프로젝트', json);
          if (res.ok) {
            await autosaveRepository.clear();
            set({ dirty: false, currentFilePath: res.path ?? null });
            get().showAppToast('저장되었습니다.', 'success');
          }
        }
      } catch {
        get().showAppToast('저장 중 오류가 발생했습니다.', 'error');
      }
    },

    async saveAsProject() {
      try {
        stampUpdatedAt();
        const project = get().derived.project;
        const json = JSON.stringify(project, null, 2);
        const res = await bridge().project.exportFile(project.name || '간트프로젝트', json);
        if (res.ok) {
          await autosaveRepository.clear();
          set({ dirty: false, currentFilePath: res.path ?? null });
          get().showAppToast('저장되었습니다.', 'success');
        }
      } catch {
        get().showAppToast('저장 중 오류가 발생했습니다.', 'error');
      }
    },

    async flushAutosave() {
      // Nothing to recover if the document was saved since the timer was armed;
      // writing anyway would raise a false recovery banner on next launch.
      if (!get().dirty) return;
      await autosaveRepository.write(get().derived.project);
    },

    async shareExport() {
      const project = get().derived.project;
      const json = JSON.stringify(project, null, 2);
      await bridge().project.exportFile(project.name || '간트프로젝트', json);
    },

    async shareImport() {
      try {
        const result = await bridge().project.importFile();
        if (!result.ok || !result.json) return;
        const project = JSON.parse(result.json) as Project;
        if (!project || typeof project !== 'object' || !Array.isArray(project.tasks)) {
          get().showAppToast('파일 형식이 올바르지 않습니다. 프로젝트 파일인지 확인하세요.', 'error');
          return;
        }
        get().loadProject(project);
        if (result.path) set({ currentFilePath: result.path });
      } catch {
        get().showAppToast('파일을 불러올 수 없습니다. 손상된 파일이거나 지원하지 않는 형식입니다.', 'error');
      }
    },

    // --- task mutations ---
    updateTask(id, patch) {
      commit((d) => {
        const t = d.tasks.find((x) => x.id === id);
        if (!t) return;
        // Normalise YYYYMMDD → YYYY-MM-DD so users can skip the hyphens.
        const norm = (v: string) =>
          /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : v;
        const normalized: Partial<Task> = { ...patch };
        if (typeof normalized.start === 'string') normalized.start = norm(normalized.start);
        if (typeof normalized.end   === 'string') normalized.end   = norm(normalized.end);
        Object.assign(t, normalized);
        if (normalized.start !== undefined || normalized.end !== undefined) {
          applyDateEdit(t, calendarOf(d), normalized.start !== undefined, normalized.end !== undefined);
        }
      }, { reschedule: affectsSchedule([patch]) });
    },

    editTaskDate(id, field, raw) {
      const state = get();
      const project = state.derived.project;
      const task = project.tasks.find((t) => t.id === id);
      if (!task) return false;
      const fail = (msg: string): false => { get().showAppToast(msg, 'error'); return false; };
      const label = `'${task.name || '이름 없는 작업'}'`;
      const current = field === 'start' ? task.start : task.end;

      const parsed = parseDateInput(raw, Number(current.slice(0, 4)) || undefined);
      if (!parsed.ok) return fail(parsed.message);
      const iso = parsed.iso;
      if (iso === current) return true;

      const isGroup = project.tasks.some((t) => t.parentId === id);
      if (isGroup) {
        if (field === 'end') {
          return fail(`${label}은(는) 그룹이라 종료일이 하위 작업의 마지막 종료일로 자동 계산됩니다. 기간을 바꾸려면 하위 작업의 날짜를 바꾸세요.`);
        }
        const delta = diffDaysISO(task.start, iso);
        const count = collectDescendants(project.tasks, id).length;
        get().moveSubtreeBy(id, delta);
        get().showAppToast(
          `그룹 ${label}을(를) 하위 작업 ${count}개와 함께 ${Math.abs(delta)}일 ${delta > 0 ? '뒤로' : '앞으로'} 옮겼습니다.`,
          'info',
        );
        return true;
      }
      if (field === 'end' && task.isMilestone) {
        return fail(`${label}은(는) 마일스톤(하루짜리 기준점)이라 종료일을 따로 정할 수 없습니다. 시작일을 바꾸세요.`);
      }
      if (field === 'end' && iso < task.start) {
        return fail(`종료일 ${formatDayKo(iso)}이(가) 시작일 ${formatDayKo(task.start)}보다 빠릅니다. 더 앞으로 당기려면 시작일을 먼저 바꾸세요.`);
      }

      get().updateTask(id, { [field]: iso } as Partial<Task>);

      // Explain any difference between what was typed and what the schedule allows.
      const after = get().derived.project;
      const got = after.tasks.find((t) => t.id === id);
      if (!got) return true;
      const cal = calendarOf(after);
      const result = field === 'start' ? got.start : got.end;
      if (result !== iso) {
        const preds = after.dependencies
          .filter((dep) => dep.toId === id)
          .map((dep) => after.tasks.find((t) => t.id === dep.fromId))
          .filter((t): t is Task => !!t && !t.cancelled);
        if (field === 'start' && !cal.isWorkingDay(iso) && result === cal.nextWorkingDay(iso)) {
          get().showAppToast(`${formatDayKo(iso)}은(는) 쉬는 날이라 다음 근무일 ${formatDayKo(result)}부터 시작합니다.`, 'info');
        } else if (field === 'end' && !cal.isWorkingDay(iso) && result === cal.previousWorkingDay(iso)) {
          get().showAppToast(`${formatDayKo(iso)}은(는) 쉬는 날이라 종료일을 바로 앞 근무일 ${formatDayKo(result)}로 맞췄습니다.`, 'info');
        } else if (preds.length > 0 && got.start > (field === 'start' ? iso : task.start)) {
          const names = preds.slice(0, 2).map((t) => `'${t.name}'`).join(', ') + (preds.length > 2 ? ` 외 ${preds.length - 2}개` : '');
          get().showAppToast(
            `${label}은(는) ${names}이(가) 끝난 뒤에 시작하도록 연결되어 있어 ${formatDayKo(got.start)}부터 시작합니다. ` +
            '연결을 무시하고 원하는 날짜에 두려면 막대를 더블클릭해 \'수동 고정\'을 켜세요.',
            'info',
          );
        } else {
          get().showAppToast(`${label}의 ${field === 'start' ? '시작일' : '종료일'}이 일정 계산에 따라 ${formatDayKo(result)}로 정해졌습니다.`, 'info');
        }
      }
      return true;
    },

    transact(fn) {
      txDepth++;
      if (txDepth === 1) txRecorded = false;
      try {
        fn();
      } finally {
        txDepth--;
      }
    },

    appendBlankTasks(parentId, count, afterId = null) {
      if (count <= 0) return [];
      const ids = Array.from({ length: count }, () => nanoid(10));
      commit((d) => {
        const siblings = d.tasks.filter((t) => t.parentId === parentId);
        const after = afterId ? siblings.find((t) => t.id === afterId) : undefined;
        const lastOrder = siblings.reduce((m, t) => Math.max(m, t.order), -1);
        const insertAt = after ? after.order + 1 : lastOrder + 1;
        for (const t of siblings) if (t.order >= insertAt) t.order += count;
        ids.forEach((id, i) => {
          d.tasks.push({
            id, parentId, name: '새 작업', start: d.startDate, end: d.startDate,
            durationDays: 1, progress: 0, priority: 'medium', assigneeIds: [], notes: '',
            isMilestone: false, collapsed: false, constraint: 'asap', constraintDate: null,
            manuallyScheduled: false, order: insertAt + i, color: null, cancelled: false,
          });
        });
      });
      return ids;
    },

    addTaskBefore(beforeId) {
      const id = nanoid(10);
      commit((d) => {
        const ref = d.tasks.find((x) => x.id === beforeId);
        if (!ref) return;
        const parentId = ref.parentId;
        const order = ref.order; // insert AT this slot, push ref down
        for (const t of d.tasks) {
          if (t.parentId === parentId && t.order >= order) t.order += 1;
        }
        d.tasks.push({
          id, parentId, name: '새 작업', start: d.startDate, end: d.startDate,
          durationDays: 1, progress: 0, priority: 'medium', assigneeIds: [], notes: '',
          isMilestone: false, collapsed: false, constraint: 'asap', constraintDate: null,
          manuallyScheduled: false, order, color: null, cancelled: false,
        });
      });
      set({ selectedTaskIds: new Set([id]), editingTaskId: id });
    },

    addTask(afterId) {
      const id = nanoid(10);
      commit((d) => {
        const ref = afterId ? d.tasks.find((x) => x.id === afterId) : undefined;
        const { parentId, insertOrder: order } = insertionPoint(d.tasks, ref);
        // Shift siblings after the insertion point.
        for (const t of d.tasks) {
          if (t.parentId === parentId && t.order >= order) t.order += 1;
        }
        d.tasks.push({
          id,
          parentId,
          name: '새 작업',
          start: d.startDate,
          end: d.startDate,
          durationDays: 1,
          progress: 0,
          priority: 'medium',
          assigneeIds: [],
          notes: '',
          isMilestone: false,
          collapsed: false,
          constraint: 'asap',
          constraintDate: null,
          manuallyScheduled: false,
          order,
          color: null,
          cancelled: false,
        });
        normaliseOrders(d.tasks);
      });
      set({ selectedTaskIds: new Set([id]), editingTaskId: id });
    },

    deleteSelected() {
      const ids = get().selectedTaskIds;
      if (ids.size === 0) return;
      const selectedTasks = get().derived.project.tasks.filter((t) => ids.has(t.id));
      // If every selected task is already cancelled → ask for permanent-delete confirmation.
      if (selectedTasks.length > 0 && selectedTasks.every((t) => t.cancelled)) {
        set({ confirmDeletePending: true });
        return;
      }
      // Otherwise soft-delete: mark selected tasks (and their descendants) as cancelled.
      commit((d) => {
        const toCancel = new Set<TaskId>(ids);
        let grew = true;
        while (grew) {
          grew = false;
          for (const t of d.tasks) {
            if (t.parentId && toCancel.has(t.parentId) && !toCancel.has(t.id)) {
              toCancel.add(t.id);
              grew = true;
            }
          }
        }
        for (const t of d.tasks) {
          if (toCancel.has(t.id)) t.cancelled = true;
        }
      });
    },

    hardDeleteSelected() {
      const ids = get().selectedTaskIds;
      if (ids.size === 0) return;
      commit((d) => {
        const toDelete = new Set<TaskId>(ids);
        let grew = true;
        while (grew) {
          grew = false;
          for (const t of d.tasks) {
            if (t.parentId && toDelete.has(t.parentId) && !toDelete.has(t.id)) {
              toDelete.add(t.id);
              grew = true;
            }
          }
        }
        d.tasks = d.tasks.filter((t) => !toDelete.has(t.id));
        d.dependencies = d.dependencies.filter(
          (dep) => !toDelete.has(dep.fromId) && !toDelete.has(dep.toId),
        );
      });
      set({ selectedTaskIds: new Set(), confirmDeletePending: false });
    },

    uncancelSelected() {
      const ids = get().selectedTaskIds;
      if (ids.size === 0) return;
      commit((d) => {
        for (const t of d.tasks) {
          if (ids.has(t.id)) t.cancelled = false;
        }
      });
    },

    cancelConfirmDelete() {
      set({ confirmDeletePending: false });
    },

    toggleCollapse(id) {
      setCollapsed((t) => (t.id === id ? !t.collapsed : t.collapsed));
    },

    expandAll() {
      setCollapsed(() => false);
    },

    collapseAll() {
      const parentIds = new Set(get().derived.project.tasks.map((t) => t.parentId).filter(Boolean));
      setCollapsed((t) => (parentIds.has(t.id) ? true : t.collapsed));
    },

    indentTask(id) {
      const before = get().derived.project;
      const self = before.tasks.find((x) => x.id === id);
      if (!self) return;
      const siblings = before.tasks
        .filter((x) => x.parentId === self.parentId)
        .sort((a, b) => a.order - b.order);
      const idx = siblings.findIndex((x) => x.id === id);
      if (idx <= 0) {
        get().showAppToast(`'${self.name}' 위에 같은 단계의 작업이 없어 하위로 넣을 수 없습니다. 하위로 넣으면 바로 위 작업이 그룹이 됩니다.`, 'error');
        return;
      }
      // New parent = the previous sibling in display order.
      const newParent = siblings[idx - 1]!;
      const wasLeaf = !before.tasks.some((x) => x.parentId === newParent.id);
      commit((d) => {
        const t = d.tasks.find((x) => x.id === id);
        if (!t) return;
        t.parentId = newParent.id;
        t.order = Number.MAX_SAFE_INTEGER; // last child; normalised below
        normaliseOrders(d.tasks);
      });
      // Keep the moved row visible.
      if (newParent.collapsed) setCollapsed((x) => (x.id === newParent.id ? false : x.collapsed));
      if (wasLeaf) {
        const links = before.dependencies.filter((dep) => dep.fromId === newParent.id || dep.toId === newParent.id).length;
        if (links > 0) {
          get().showAppToast(
            `'${newParent.name}'이(가) 그룹이 되었습니다. 그룹에는 연결이 적용되지 않아, '${newParent.name}'에 걸려 있던 연결 ${links}개는 이제 일정에 영향을 주지 않습니다. 필요하면 하위 작업끼리 다시 연결하세요. (되돌리기: Ctrl+Z)`,
            'info',
          );
        }
      }
    },

    outdentTask(id) {
      commit((d) => {
        const t = d.tasks.find((x) => x.id === id);
        if (!t || !t.parentId) return;
        const parent = d.tasks.find((x) => x.id === t.parentId);
        if (!parent) return;
        t.parentId = parent.parentId;
        t.order = parent.order + 0.5; // re-normalised below
        normaliseOrders(d.tasks);
      });
    },

    moveTaskBy(id, deltaDays) {
      if (deltaDays === 0) return;
      commit((d) => {
        const t = d.tasks.find((x) => x.id === id);
        if (!t) return;
        t.start = addDaysISO(t.start, deltaDays);
        t.end = addDaysISO(t.end, deltaDays);
        // Use SNET instead of a full manual pin: "start no earlier than here
        // but still follow predecessors if they push past this date."
        // This lets successor tasks continue to propagate when their
        // predecessor moves forward, while keeping the task anchored when
        // predecessors are moved backward.
        t.constraint = 'snet';
        t.constraintDate = t.start;
        t.manuallyScheduled = false;
      });
    },

    resizeTask(id, edge, deltaDays) {
      if (deltaDays === 0) return;
      commit((d) => {
        const t = d.tasks.find((x) => x.id === id);
        if (!t || t.isMilestone) return;
        if (edge === 'start') {
          const next = addDaysISO(t.start, deltaDays);
          if (next <= t.end) t.start = next;
        } else {
          const next = addDaysISO(t.end, deltaDays);
          if (next >= t.start) t.end = next;
        }
        applyDateEdit(t, calendarOf(d), edge === 'start');
      });
    },

    moveTaskUp(id) {
      commit((d) => {
        const t = d.tasks.find((x) => x.id === id);
        if (!t) return;
        const siblings = d.tasks
          .filter((x) => x.parentId === t.parentId)
          .sort((a, b) => a.order - b.order);
        const idx = siblings.findIndex((x) => x.id === id);
        if (idx <= 0) return;
        const prev = siblings[idx - 1]!;
        [t.order, prev.order] = [prev.order, t.order];
      });
    },

    moveTaskDown(id) {
      commit((d) => {
        const t = d.tasks.find((x) => x.id === id);
        if (!t) return;
        const siblings = d.tasks
          .filter((x) => x.parentId === t.parentId)
          .sort((a, b) => a.order - b.order);
        const idx = siblings.findIndex((x) => x.id === id);
        if (idx >= siblings.length - 1) return;
        const next = siblings[idx + 1]!;
        [t.order, next.order] = [next.order, t.order];
      });
    },

    moveTaskBefore(draggedId, targetId) {
      commit((d) => {
        const dragged = d.tasks.find((x) => x.id === draggedId);
        const target = d.tasks.find((x) => x.id === targetId);
        if (!dragged || !target || draggedId === targetId) return;
        // Only allow reorder within same parent.
        if (dragged.parentId !== target.parentId) return;
        const siblings = d.tasks
          .filter((x) => x.parentId === dragged.parentId)
          .sort((a, b) => a.order - b.order);
        const fromIdx = siblings.findIndex((x) => x.id === draggedId);
        const toIdx = siblings.findIndex((x) => x.id === targetId);
        if (fromIdx === -1 || toIdx === -1) return;
        // Splice and re-assign orders.
        const [item] = siblings.splice(fromIdx, 1);
        const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
        siblings.splice(insertAt, 0, item!);
        siblings.forEach((s, i) => { s.order = i; });
      });
    },

    moveTasks(taskIds, newParentId, afterId) {
      const all = get().derived.project.tasks;
      const byId = new Map(all.map((t) => [t.id, t]));
      const movers = topLevelInDisplayOrder(all, taskIds);
      if (movers.length === 0) return '옮길 작업이 없습니다. 잘라낸 작업이 이미 삭제되었을 수 있습니다.';
      if (newParentId !== null && !byId.has(newParentId)) return '붙여넣을 위치를 찾을 수 없습니다.';
      // Refuse moving a task into itself or its own subtree.
      if (newParentId !== null) {
        for (const m of movers) {
          if (m.id === newParentId || collectDescendants(all, m.id).includes(newParentId)) {
            return `'${m.name}'을(를) 자기 자신이나 자기 하위 작업 안으로는 옮길 수 없습니다. 다른 위치를 고르세요.`;
          }
        }
      }
      const moverIds = new Set(movers.map((m) => m.id));
      commit((d) => {
        const dest = d.tasks
          .filter((t) => t.parentId === newParentId && !moverIds.has(t.id))
          .sort((x, y) => x.order - y.order);
        let insertAt = dest.length; // default: append at the end of the group
        if (afterId) {
          const idx = dest.findIndex((t) => t.id === afterId);
          if (idx !== -1) insertAt = idx + 1;
        }
        // Keep the on-screen order of the moved rows (they may come from
        // different groups, whose `order` values are not comparable).
        const moved = movers.map((m) => d.tasks.find((t) => t.id === m.id)!).filter(Boolean);
        for (const m of moved) m.parentId = newParentId;
        [...dest.slice(0, insertAt), ...moved, ...dest.slice(insertAt)].forEach((t, i) => { t.order = i; });
        normaliseOrders(d.tasks);
      });
      // Show where the rows went: expand the destination group chain.
      if (newParentId) {
        const chain = new Set<TaskId>();
        let cur: TaskId | null = newParentId;
        while (cur) { chain.add(cur); cur = get().derived.project.tasks.find((t) => t.id === cur)?.parentId ?? null; }
        setCollapsed((t) => (chain.has(t.id) ? false : t.collapsed));
      }
      set({ selectedTaskIds: new Set(movers.map((m) => m.id)) });
      return null;
    },

    duplicateSelected() {
      const ids = [...get().selectedTaskIds];
      if (ids.length === 0) return;
      get().duplicateTasks(ids);
    },

    duplicateTasks(ids) {
      const all = get().derived.project.tasks;
      const roots = topLevelInDisplayOrder(all, ids);
      if (roots.length === 0) return [];
      const newRoots: TaskId[] = [];
      let copied = 0;
      commit((d) => {
        for (const root of roots) {
          const subtree = [root.id, ...collectDescendants(d.tasks, root.id)];
          const idMap = new Map<TaskId, TaskId>(subtree.map((sid) => [sid, nanoid(10)]));
          for (const sid of subtree) {
            const orig = d.tasks.find((t) => t.id === sid);
            if (!orig) continue;
            d.tasks.push({
              ...structuredClone(orig),
              id: idMap.get(sid)!,
              parentId: sid === root.id ? orig.parentId : idMap.get(orig.parentId!)!,
              // Root copy goes right after its original; children keep their order.
              order: sid === root.id ? orig.order + 0.5 : orig.order,
            });
            copied++;
          }
          // Links between tasks inside the copied subtree are copied too.
          for (const dep of [...d.dependencies]) {
            const from = idMap.get(dep.fromId);
            const to = idMap.get(dep.toId);
            if (from && to) d.dependencies.push({ ...dep, id: nanoid(8), fromId: from, toId: to });
          }
          newRoots.push(idMap.get(root.id)!);
        }
        normaliseOrders(d.tasks);
      });
      set({ selectedTaskIds: new Set(newRoots) });
      get().showAppToast(
        copied > newRoots.length
          ? `작업 ${newRoots.length}개를 하위 작업까지 모두 ${copied}개 복제했습니다.`
          : `작업 ${newRoots.length}개를 복제했습니다.`,
        'success',
      );
      return newRoots;
    },

    duplicateTask(id) {
      get().duplicateTasks([id]);
    },

    moveSubtreeBy(id, deltaDays) {
      if (deltaDays === 0) return;
      commit((d) => {
        const collect = (pid: TaskId): TaskId[] => {
          const result: TaskId[] = [pid];
          for (const t of d.tasks) {
            if (t.parentId === pid) result.push(...collect(t.id));
          }
          return result;
        };
        for (const tid of collect(id)) {
          const t = d.tasks.find((x) => x.id === tid);
          if (!t) continue;
          t.start = addDaysISO(t.start, deltaDays);
          t.end = addDaysISO(t.end, deltaDays);
          // Anchor at the new position (same rule as a single-bar drag) so the
          // scheduler does not snap the move back, while predecessors that end
          // later can still push it.
          if (!t.manuallyScheduled) {
            t.constraint = 'snet';
            t.constraintDate = t.start;
          }
        }
      });
    },

    groupSelectedTasks() {
      const ids = [...get().selectedTaskIds];
      const all = get().derived.project.tasks;
      const topLevel = topLevelInDisplayOrder(all, ids);
      if (topLevel.length < 2) {
        get().showAppToast('묶으려면 작업을 2개 이상 선택하세요. (Ctrl+클릭 또는 Shift+클릭)', 'error');
        return;
      }
      const parents = new Set(topLevel.map((t) => t.parentId));
      if (parents.size > 1) {
        get().showAppToast(
          '서로 다른 그룹에 있는 작업은 한 그룹으로 묶을 수 없습니다. 먼저 같은 그룹으로 옮긴 뒤(잘라내기 → 붙여넣기) 묶으세요.',
          'error',
        );
        return;
      }
      const commonParent = topLevel[0]!.parentId;
      const first = topLevel[0]!;
      const newId = nanoid(10) as TaskId;
      const topIds = new Set(topLevel.map((t) => t.id));
      commit((d) => {
        d.tasks.push({
          id: newId, parentId: commonParent, name: '새 그룹',
          start: first.start, end: first.end, durationDays: 1,
          progress: 0, priority: 'medium', assigneeIds: [], notes: '',
          isMilestone: false, collapsed: false, constraint: 'asap',
          constraintDate: null, manuallyScheduled: false,
          order: first.order - 0.5, color: null, cancelled: false,
        });
        // Only the top-level picks move under the new group; their own children
        // stay with them (they used to be pulled out of their parents).
        topLevel.forEach((orig, i) => {
          const t = d.tasks.find((x) => x.id === orig.id);
          if (t && topIds.has(t.id)) { t.parentId = newId; t.order = i; }
        });
        normaliseOrders(d.tasks);
      });
      set({ selectedTaskIds: new Set([newId]), editingTaskId: newId });
      get().showAppToast(`작업 ${topLevel.length}개를 '새 그룹'으로 묶었습니다. 그룹 이름을 바로 입력하세요.`, 'info');
    },



    importTsvTasks(text) {
      const badDates: string[] = [];
      const dataRows = parseTsvDataRows(text);
      if (dataRows.length === 0) return;
      const newIds: TaskId[] = [];
      commit((d) => {
        const baseOrder = d.tasks.length;
        dataRows.forEach((cols, i) => {
          const [rawName, rawStart0, rawEnd0] = cols;
          const rawStart = lenientDay(rawStart0, badDates, i + 1);
          const rawEnd = lenientDay(rawEnd0, badDates, i + 1);
          // 4-col legacy: name,start,end,progress
          // 6-col new:    name,start,end,duration(skip),progress,priority
          const rawProgress = cols.length >= 5 ? cols[4] : cols[3];
          const rawPriority = cols.length >= 6 ? cols[5] : undefined;
          const name = (rawName || '새 작업').slice(0, 200);
          const isValidISO = (v: string | undefined): v is string => !!v;
          const startDate = isValidISO(rawStart) ? rawStart : d.startDate;
          const endDate = isValidISO(rawEnd) && rawEnd >= startDate ? rawEnd : startDate;
          const progress = rawProgress
            ? Math.min(100, Math.max(0, parseInt(rawProgress, 10) || 0))
            : 0;
          const priority = rawPriority ? (TSV_PRIORITY_MAP[rawPriority.toLowerCase()] ?? 'medium') : 'medium';
          const id = nanoid(10);
          newIds.push(id);
          d.tasks.push({
            id,
            parentId: null,
            name,
            start: startDate,
            end: endDate,
            durationDays: Math.max(1, calendarOf(d).workingDaysBetween(startDate, endDate)),
            progress,
            priority,
            assigneeIds: [],
            notes: '',
            isMilestone: false,
            collapsed: false,
            // Pasted dates anchor the task like a typed start (see applyDateEdit).
            constraint: isValidISO(rawStart) ? 'snet' : 'asap',
            constraintDate: isValidISO(rawStart) ? startDate : null,
            manuallyScheduled: false,
            order: baseOrder + i,
            color: null,
            cancelled: false,
          });
        });
      });
      reportBadDates(badDates, get().showAppToast);
      set({ selectedTaskIds: new Set(newIds) });
    },

    insertTsvTasks(afterId, text) {
      const badDates: string[] = [];
      const dataRows = parseTsvDataRows(text);
      if (dataRows.length === 0) return 0;
      const newIds: TaskId[] = [];
      commit((d) => {
        const ref = afterId ? d.tasks.find((x) => x.id === afterId) : undefined;
        // "Right below this row" on screen: below an expanded group's title row
        // is its first child slot; otherwise the rows become siblings after
        // `ref` (or are appended at the root).
        const { parentId, insertOrder } = insertionPoint(d.tasks, ref);
        // Shift later siblings down to make room for the inserted block.
        for (const t of d.tasks) {
          if (t.parentId === parentId && t.order >= insertOrder) t.order += dataRows.length;
        }
        dataRows.forEach((cols, i) => {
          const [rawName, rawStart0, rawEnd0] = cols;
          const rawStart = lenientDay(rawStart0, badDates, i + 1);
          const rawEnd = lenientDay(rawEnd0, badDates, i + 1);
          const rawProgress = cols.length >= 5 ? cols[4] : cols[3];
          const rawPriority = cols.length >= 6 ? cols[5] : undefined;
          const name = (rawName || '새 작업').slice(0, 200);
          const isValidISO = (v: string | undefined): v is string => !!v;
          const startDate = isValidISO(rawStart) ? rawStart : d.startDate;
          const endDate = isValidISO(rawEnd) && rawEnd >= startDate ? rawEnd : startDate;
          const progress = rawProgress
            ? Math.min(100, Math.max(0, parseInt(rawProgress, 10) || 0))
            : 0;
          const priority = rawPriority ? (TSV_PRIORITY_MAP[rawPriority.toLowerCase()] ?? 'medium') : 'medium';
          const id = nanoid(10);
          newIds.push(id);
          d.tasks.push({
            id,
            parentId,
            name,
            start: startDate,
            end: endDate,
            durationDays: Math.max(1, calendarOf(d).workingDaysBetween(startDate, endDate)),
            progress,
            priority,
            assigneeIds: [],
            notes: '',
            isMilestone: false,
            collapsed: false,
            // Pasted dates anchor the task like a typed start (see applyDateEdit).
            constraint: isValidISO(rawStart) ? 'snet' : 'asap',
            constraintDate: isValidISO(rawStart) ? startDate : null,
            manuallyScheduled: false,
            order: insertOrder + i,
            color: null,
            cancelled: false,
          });
        });
        normaliseOrders(d.tasks);
      });
      reportBadDates(badDates, get().showAppToast);
      set({ selectedTaskIds: new Set(newIds) });
      return newIds.length;
    },

    updateTasksFromTsv(taskIds, tsvText) {
      const badDates: string[] = [];
      const dataRows = parseTsvDataRows(tsvText);
      if (dataRows.length === 0 || taskIds.length === 0) return;
      commit((d) => {
        const cal = calendarOf(d);
        taskIds.forEach((id, i) => {
          const cols = dataRows[i];
          if (!cols) return;
          const task = d.tasks.find((t) => t.id === id);
          if (!task) return;
          const [rawName, rawStart0, rawEnd0] = cols;
          const rawStart = lenientDay(rawStart0, badDates, i + 1);
          const rawEnd = lenientDay(rawEnd0, badDates, i + 1);
          const rawProgress = cols.length >= 5 ? cols[4] : cols[3];
          const rawPriority = cols.length >= 6 ? cols[5] : undefined;
          const isValidISO = (v: string | undefined): v is string => !!v;
          if (rawName?.trim()) task.name = rawName.trim().slice(0, 200);
          // A group's dates are rolled up from its children: never overwrite them.
          const isGroup = d.tasks.some((t) => t.parentId === task.id);
          if (isGroup && (rawStart || rawEnd)) {
            badDates.push(`${i + 1}행: '${task.name}'은(는) 그룹이라 날짜가 자동 계산되므로 날짜를 건너뛰었습니다.`);
          } else if (isValidISO(rawStart) && isValidISO(rawEnd) && rawEnd < rawStart) {
            badDates.push(`${i + 1}행: 종료일 ${rawEnd}이(가) 시작일 ${rawStart}보다 빨라 날짜를 건너뛰었습니다.`);
          } else if (isValidISO(rawStart) && isValidISO(rawEnd)) {
            task.start = rawStart;
            task.end = rawEnd;
            applyDateEdit(task, cal, true, true);
          } else if (isValidISO(rawStart)) {
            const delta = diffDaysISO(task.start, rawStart);
            task.start = rawStart;
            task.end = addDaysISO(task.end, delta);
            applyDateEdit(task, cal, true);
          }
          if (rawProgress?.trim()) {
            const p = parseInt(rawProgress, 10);
            if (!isNaN(p)) task.progress = Math.min(100, Math.max(0, p));
          }
          if (rawPriority?.trim()) {
            const p = TSV_PRIORITY_MAP[rawPriority.trim().toLowerCase()];
            if (p) task.priority = p;
          }
        });
      });
      reportBadDates(badDates, get().showAppToast);
    },

    batchUpdateTasks(updates) {
      if (updates.length === 0) return;
      commit((d) => {
        const norm = (v: string) =>
          /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : v;
        const byId = new Map(d.tasks.map((x) => [x.id, x]));
        const cal = calendarOf(d);
        for (const { id, patch } of updates) {
          const t = byId.get(id);
          if (!t) continue;
          const normalized: Partial<Task> = { ...patch };
          if (typeof normalized.start === 'string') normalized.start = norm(normalized.start);
          if (typeof normalized.end   === 'string') normalized.end   = norm(normalized.end);
          Object.assign(t, normalized);
          if (t.start > t.end) t.end = t.start;
          if (normalized.start !== undefined || normalized.end !== undefined) {
            applyDateEdit(t, cal, normalized.start !== undefined);
          }
        }
      }, { reschedule: affectsSchedule(updates.map((u) => u.patch)) });
    },

    // --- dependencies ---
    addDependency(fromId, toId, type = 'FS') {
      if (fromId === toId) return false;
      const deps = get().derived.project.dependencies;
      if (deps.some((dep) => dep.fromId === fromId && dep.toId === toId)) return false;
      if (wouldCreateCycle(deps, fromId, toId)) return false;
      commit((d) => {
        d.dependencies.push({ id: nanoid(10), fromId, toId, type, lagDays: 0 });
      });
      return true;
    },

    updateDependency(id, patch) {
      commit((d) => {
        const dep = d.dependencies.find((x) => x.id === id);
        if (dep) Object.assign(dep, patch);
      });
    },

    removeDependency(id) {
      commit((d) => {
        d.dependencies = d.dependencies.filter((x) => x.id !== id);
      });
    },

    // --- resources / holidays / calendar ---
    upsertResource(resource) {
      commit((d) => {
        const idx = d.resources.findIndex((r) => r.id === resource.id);
        if (idx >= 0) d.resources[idx] = resource;
        else d.resources.push(resource);
      });
    },

    removeResource(id) {
      commit((d) => {
        d.resources = d.resources.filter((r) => r.id !== id);
        for (const t of d.tasks) t.assigneeIds = t.assigneeIds.filter((a) => a !== id);
      });
    },

    upsertHoliday(holiday) {
      commit((d) => {
        const idx = d.holidays.findIndex((h) => h.date === holiday.date);
        if (idx >= 0) d.holidays[idx] = holiday;
        else d.holidays.push(holiday);
        d.holidays.sort((a, b) => a.date.localeCompare(b.date));
      });
    },

    removeHoliday(date) {
      commit((d) => {
        d.holidays = d.holidays.filter((h) => h.date !== date);
      });
    },

    setCalendar(patch) {
      commit((d) => {
        d.calendar = { ...d.calendar, ...patch };
      });
    },

    // --- baselines ---
    captureBaseline(name) {
      commit((d) => {
        const baseline: Baseline = {
          id: nanoid(8),
          name,
          capturedAt: new Date().toISOString(),
          entries: d.tasks.map((t) => ({
            taskId: t.id,
            start: t.start,
            end: t.end,
            durationDays: t.durationDays,
          })),
        };
        d.baselines.push(baseline);
        d.activeBaselineId = baseline.id;
      });
    },

    setActiveBaseline(id) {
      commit((d) => {
        d.activeBaselineId = id;
      });
    },

    removeBaseline(id) {
      commit((d) => {
        d.baselines = d.baselines.filter((b) => b.id !== id);
        if (d.activeBaselineId === id) d.activeBaselineId = null;
      });
    },

    // --- view groups (보기 그룹) ---
    createViewGroup(name, taskIds = []) {
      const id = nanoid(8);
      const color = GROUP_COLORS[get().derived.project.viewGroups.length % GROUP_COLORS.length]!;
      commit((d) => {
        d.viewGroups.push({ id, name: name.trim() || `그룹 ${d.viewGroups.length + 1}`, color, taskIds: [...new Set(taskIds)] });
      });
      return id;
    },

    renameViewGroup(id, name) {
      commit((d) => {
        const g = d.viewGroups.find((x) => x.id === id);
        if (g) g.name = name.trim() || g.name;
      });
    },

    setViewGroupColor(id, color) {
      commit((d) => {
        const g = d.viewGroups.find((x) => x.id === id);
        if (g) g.color = color;
      });
    },

    removeViewGroup(id) {
      commit((d) => {
        d.viewGroups = d.viewGroups.filter((g) => g.id !== id);
      });
      // Drop the filter if it pointed at the removed group.
      set((s) =>
        s.view.filterGroupId === id
          ? { view: { ...s.view, filterMode: 'all', filterGroupId: null } }
          : {},
      );
    },

    addTasksToGroup(groupId, taskIds) {
      commit((d) => {
        const g = d.viewGroups.find((x) => x.id === groupId);
        if (!g) return;
        const set = new Set(g.taskIds);
        for (const id of taskIds) set.add(id);
        g.taskIds = [...set];
      });
    },

    removeTasksFromGroup(groupId, taskIds) {
      const drop = new Set(taskIds);
      commit((d) => {
        const g = d.viewGroups.find((x) => x.id === groupId);
        if (g) g.taskIds = g.taskIds.filter((t) => !drop.has(t));
      });
    },

    // --- chart markers ---
    addMarker(marker) {
      commit((d) => {
        d.markers = d.markers ?? [];
        d.markers.push({ ...marker, id: nanoid() });
      });
    },
    updateMarker(id, patch) {
      commit((d) => {
        const m = (d.markers ?? []).find((x) => x.id === id);
        if (m) Object.assign(m, patch);
      });
    },
    removeMarker(id) {
      commit((d) => { d.markers = (d.markers ?? []).filter((m) => m.id !== id); });
    },

    // --- history ---
    undo() {
      const { past, derived, future } = get();
      if (past.length === 0) return;
      const prev = past[past.length - 1]!;
      const solved = recalc(keepCollapse(prev));
      const newDerived = { ...solved, project: shareProject(derived.project, solved.project) };
      set({
        derived: newDerived,
        project: newDerived.project,
        past: past.slice(0, -1),
        future: [derived.project, ...future].slice(0, HISTORY_LIMIT),
        dirty: true,
      });
    },

    redo() {
      const { future, derived, past } = get();
      if (future.length === 0) return;
      const next = future[0]!;
      const solved = recalc(keepCollapse(next));
      const newDerived = { ...solved, project: shareProject(derived.project, solved.project) };
      set({
        derived: newDerived,
        project: newDerived.project,
        future: future.slice(1),
        past: [...past, derived.project].slice(-HISTORY_LIMIT),
        dirty: true,
      });
    },

    // --- selection ---
    selectTask(id, additive = false) {
      set((s) => {
        const next = additive ? new Set(s.selectedTaskIds) : new Set<TaskId>();
        if (additive && next.has(id)) next.delete(id);
        else next.add(id);
        return { selectedTaskIds: next };
      });
    },

    setSelectedTaskIds(ids) {
      set({ selectedTaskIds: ids });
    },

    clearSelection() {
      set({ selectedTaskIds: new Set(), editingTaskId: null });
    },

    setEditing(id) {
      set({ editingTaskId: id });
    },

    setInspecting(id) {
      set({ inspectingTaskId: id });
    },

    beginLink(id) {
      set({ linkSourceId: id });
    },

    // --- view ---
    setTheme(theme) {
      set((s) => ({ view: { ...s.view, theme } }));
    },
    toggleTheme() {
      set((s) => ({ view: { ...s.view, theme: s.view.theme === 'dark' ? 'light' : 'dark' } }));
    },
    setZoom(zoom) {
      set((s) => ({ view: { ...s.view, zoom } }));
    },
    zoomBy(direction) {
      set((s) => ({ view: { ...s.view, zoom: stepZoom(s.view.zoom, direction) } }));
    },
    toggleCriticalPath() {
      set((s) => ({ view: { ...s.view, showCriticalPath: !s.view.showCriticalPath } }));
    },
    toggleBaseline() {
      set((s) => ({ view: { ...s.view, showBaseline: !s.view.showBaseline } }));
    },
    toggleTodayLine() {
      set((s) => ({ view: { ...s.view, showTodayLine: !s.view.showTodayLine } }));
    },
    setGridWidth(width) {
      set((s) => ({ view: { ...s.view, gridWidth: Math.max(240, Math.min(900, width)) } }));
    },
    toggleGridCollapse() {
      set((s) => ({ view: { ...s.view, gridCollapsed: !s.view.gridCollapsed } }));
    },
    setActiveView(activeView) {
      set((s) => ({ view: { ...s.view, activeView } }));
    },
    setViewFilter(mode, groupId = null, assigneeIds) {
      set((s) => {
        // "focus" snapshots the current selection so later clicks don't churn it.
        const focusIds = mode === 'focus' ? [...s.selectedTaskIds] : s.view.focusIds;
        // Ignore a focus request with nothing selected.
        if (mode === 'focus' && focusIds.length === 0) return {};
        return {
          view: {
            ...s.view,
            filterMode: mode,
            filterGroupId: mode === 'group' ? groupId : null,
            focusIds,
            filterAssigneeIds: mode === 'assignee' ? (assigneeIds ?? []) : s.view.filterAssigneeIds,
          },
        };
      });
    },
    clearViewFilter() {
      set((s) => ({ view: { ...s.view, filterMode: 'all', filterGroupId: null, filterAssigneeIds: [] } }));
    },
    scaleDayWidth(factor) {
      set((s) => ({
        view: { ...s.view, dayWidthScale: Math.max(0.1, Math.min(10, s.view.dayWidthScale * factor)) },
      }));
    },
    setDayWidthScale(scale) {
      set((s) => ({ view: { ...s.view, dayWidthScale: Math.max(0.1, Math.min(10, scale)) } }));
    },
    setRowHeight(height) {
      set((s) => ({ view: { ...s.view, rowHeight: Math.max(20, Math.min(80, Math.round(height))) } }));
    },

    setNameFilter(text) {
      set((s) => ({ view: { ...s.view, nameFilter: text } }));
    },

    sortChildrenByStart(parentId) {
      commit((d) => {
        const children = d.tasks.filter((t) => t.parentId === parentId);
        if (children.length < 2) return;
        children.sort((a, b) => a.start.localeCompare(b.start));
        children.forEach((t, i) => { t.order = i; });
        // Shift all other siblings' orders above the re-used range so there
        // are no collisions with unrelated siblings at the same parent level.
        const maxOrder = children.length;
        for (const t of d.tasks) {
          if (t.parentId === parentId && !children.includes(t)) {
            t.order += maxOrder;
          }
        }
      });
    },

    scrollGanttToDate(date) {
      set((s) => ({ view: { ...s.view, ganttScrollTo: date } }));
    },

    clearGanttScroll() {
      set((s) => ({ view: { ...s.view, ganttScrollTo: null } }));
    },

    showAppToast(msg, type = 'error') {
      set((s) => ({ view: { ...s.view, appToast: { msg, type, id: Date.now() } } }));
    },

    clearAppToast() {
      set((s) => ({ view: { ...s.view, appToast: null } }));
    },
  };
});

/** Default chip colours assigned to new view groups, cycled in order. */
const GROUP_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

/** Re-pack sibling `order` values into clean 0..n integers. */
function normaliseOrders(tasks: Task[]): void {
  const groups = new Map<TaskId | null, Task[]>();
  for (const t of tasks) {
    const key = t.parentId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.order - b.order);
    group.forEach((t, i) => (t.order = i));
  }
}
