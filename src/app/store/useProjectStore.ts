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
import { wouldCreateCycle } from '@/services/dependency/graph';
import { autosaveRepository, projectRepository } from '@/services/persistence/projectRepository';
import { bridge } from '@/shared/bridge';
import { addDaysISO, diffDaysISO } from '@/shared/date/dateUtils';
import type { ZoomLevel } from '@/features/gantt/zoom';
import { stepZoom } from '@/features/gantt/zoom';

const HISTORY_LIMIT = 100; // ≥100 undo steps as required.
const AUTOSAVE_INTERVAL_MS = 60_000; // 1-minute autosave.

export type ThemeMode = 'light' | 'dark';
export type ActiveView = 'gantt' | 'resources' | 'calendar' | 'groups';

interface ViewState {
  theme: ThemeMode;
  zoom: ZoomLevel;
  showCriticalPath: boolean;
  showBaseline: boolean;
  /** Left grid pane width in pixels (resizable split). */
  gridWidth: number;
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
  /**
   * One-shot scroll request for the gantt: when non-null the GanttChart will
   * scroll so this ISO date is near the left edge of the viewport, then clear
   * the field back to null.
   */
  ganttScrollTo: string | null;
}

interface ClipboardState {
  tasks: Task[];
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
  clipboard: ClipboardState | null;
  /** True when all selected tasks are already cancelled and awaiting hard-delete confirmation. */
  confirmDeletePending: boolean;
  // --- view ---
  view: ViewState;
  dirty: boolean;
  recoveryAvailable: boolean;

  // --- lifecycle ---
  loadProject: (project: Project) => void;
  newProject: (name?: string) => void;
  renameProject: (name: string) => void;
  saveProject: () => Promise<void>;
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
  moveTasks: (taskIds: TaskId[], newParentId: TaskId | null, afterId: TaskId | null) => void;
  duplicateSelected: () => void;
  copySelected: () => void;
  paste: () => void;
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
  setGridWidth: (width: number) => void;
  setActiveView: (view: ActiveView) => void;
  /** Show all tasks, a specific view group, the current selection, or tasks by assignee. */
  setViewFilter: (mode: FilterMode, groupId?: string | null, assigneeIds?: string[]) => void;
  clearViewFilter: () => void;
  /** Multiply the fine-zoom dayWidth scale (Ctrl+Wheel). Clamped to [0.1, 10]. */
  scaleDayWidth: (factor: number) => void;
  /** Set the fine-zoom dayWidth scale directly. Clamped to [0.1, 10]. */
  setDayWidthScale: (scale: number) => void;
  /**
   * Sort the direct children of the given task by their start date (ascending).
   * Sibling order values are reassigned; the subtrees themselves are untouched.
   */
  sortChildrenByStart: (parentId: TaskId) => void;
  /** Ask the GanttChart to scroll so `date` is visible near the left edge. */
  scrollGanttToDate: (date: string) => void;
  /** Called by GanttChart after it has consumed a scrollGanttToDate request. */
  clearGanttScroll: () => void;
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

/** Build the initial empty document so the store always has a valid project. */
function emptyProject(): Project {
  return {
    schemaVersion: 1,
    id: nanoid(8),
    name: '새 프로젝트',
    startDate: new Date().toISOString().slice(0, 10),
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
function parseTsvDataRows(text: string): string[][] {
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

export const useProjectStore = create<ProjectStore>((set, get) => {
  const initialDerived = recalc(emptyProject());

  /**
   * Apply a pure mutation to a deep clone of the current project, re-solve the
   * schedule, push the previous state onto the undo stack, and schedule an
   * autosave. This is the single write path for all document edits.
   */
  function commit(mutator: (draft: Project) => void): void {
    const state = get();
    const prev = state.derived.project;
    const draft: Project = structuredClone(prev);
    mutator(draft);
    const derived = recalc(draft);
    const past = [...state.past, prev].slice(-HISTORY_LIMIT);
    set({ derived, project: derived.project, past, future: [], dirty: true });
    scheduleAutosave();
  }

  function scheduleAutosave(): void {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
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
    clipboard: null,
    confirmDeletePending: false,
    dirty: false,
    recoveryAvailable: false,
    view: {
      theme: 'dark',
      zoom: 'day',
      showCriticalPath: true,
      showBaseline: false,
      gridWidth: 460,
      activeView: 'gantt',
      filterMode: 'all',
      filterGroupId: null,
      focusIds: [],
      filterAssigneeIds: [],
      dayWidthScale: 1.0,
      ganttScrollTo: null,
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
      const derived = recalc({ ...project, markers: project.markers ?? [] });
      set((s) => ({
        derived,
        project: derived.project,
        past: [],
        future: [],
        selectedTaskIds: new Set(),
        dirty: false,
        // Groups belong to the loaded document; reset any stale filter.
        view: { ...s.view, filterMode: 'all', filterGroupId: null, focusIds: [] },
      }));
    },

    async saveProject() {
      commit((d) => { d.updatedAt = new Date().toISOString(); });
      await projectRepository.save(get().derived.project);
      await autosaveRepository.clear();
      set({ dirty: false });
    },

    async flushAutosave() {
      await autosaveRepository.write(get().derived.project);
    },

    async shareExport() {
      const project = get().derived.project;
      const json = JSON.stringify(project, null, 2);
      await bridge().project.exportFile(project.name || '간트프로젝트', json);
    },

    async shareImport() {
      const result = await bridge().project.importFile();
      if (!result.ok || !result.json) return;
      try {
        const project = JSON.parse(result.json) as Project;
        get().loadProject(project);
      } catch {
        // Silently ignore malformed JSON — could show a toast in the future
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
        // If start moved past end, snap end to the new start.
        if (t.start > t.end) t.end = t.start;
        // Editing dates directly implies a manual pin unless cleared.
        if (patch.start || patch.end) t.manuallyScheduled = true;
      });
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
        const parentId = ref?.parentId ?? null;
        const order = ref ? ref.order + 1 : d.tasks.length;
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
      commit((d) => {
        const t = d.tasks.find((x) => x.id === id);
        if (t) t.collapsed = !t.collapsed;
      });
    },

    expandAll() {
      commit((d) => { for (const t of d.tasks) t.collapsed = false; });
    },

    collapseAll() {
      const parentIds = new Set(get().derived.project.tasks.map((t) => t.parentId).filter(Boolean));
      commit((d) => { for (const t of d.tasks) if (parentIds.has(t.id)) t.collapsed = true; });
    },

    indentTask(id) {
      commit((d) => {
        const t = d.tasks.find((x) => x.id === id);
        if (!t) return;
        // New parent = the previous sibling in display order.
        const siblings = d.tasks
          .filter((x) => x.parentId === t.parentId)
          .sort((a, b) => a.order - b.order);
        const idx = siblings.findIndex((x) => x.id === id);
        if (idx <= 0) return;
        const newParent = siblings[idx - 1]!;
        t.parentId = newParent.id;
        const newSiblings = d.tasks.filter((x) => x.parentId === newParent.id);
        t.order = newSiblings.length;
      });
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
        t.durationDays = Math.max(1, diffDaysISO(t.start, t.end) + 1);
        t.manuallyScheduled = true;
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
      if (taskIds.length === 0) return;
      const ids = new Set(taskIds);
      commit((d) => {
        if (newParentId !== null && !d.tasks.some((t) => t.id === newParentId)) return;

        const parentOf = (id: TaskId | null): TaskId | null =>
          id ? (d.tasks.find((t) => t.id === id)?.parentId ?? null) : null;
        const isDescendantOf = (maybeChild: TaskId, ancestor: TaskId): boolean => {
          let p: TaskId | null = parentOf(maybeChild);
          while (p) {
            if (p === ancestor) return true;
            p = parentOf(p);
          }
          return false;
        };

        // Refuse to move a task into itself or into one of its own descendants.
        if (newParentId !== null) {
          for (const id of ids) {
            if (id === newParentId || isDescendantOf(newParentId, id)) return;
          }
        }

        // Top-level movers only: a cut child whose ancestor is also cut rides
        // along with that ancestor's subtree, so skip it here.
        const movers = d.tasks
          .filter((t) => ids.has(t.id))
          .filter((t) => ![...ids].some((other) => other !== t.id && isDescendantOf(t.id, other)))
          .sort((a, b) => a.order - b.order);
        if (movers.length === 0) return;

        const moverSet = new Set(movers.map((m) => m.id));
        const dest = d.tasks
          .filter((t) => t.parentId === newParentId && !moverSet.has(t.id))
          .sort((a, b) => a.order - b.order);

        let insertAt = dest.length; // default: append at end
        if (afterId) {
          const idx = dest.findIndex((t) => t.id === afterId);
          if (idx !== -1) insertAt = idx + 1;
        }

        for (const m of movers) m.parentId = newParentId;
        const combined = [...dest.slice(0, insertAt), ...movers, ...dest.slice(insertAt)];
        combined.forEach((t, i) => { t.order = i; });
      });
      set({ selectedTaskIds: new Set(taskIds) });
    },

    duplicateSelected() {
      const ids = get().selectedTaskIds;
      if (ids.size === 0) return;
      const newIds: TaskId[] = [];
      commit((d) => {
        for (const id of ids) {
          const t = d.tasks.find((x) => x.id === id);
          if (!t) continue;
          const copy: Task = { ...structuredClone(t), id: nanoid(10), order: t.order + 0.5 };
          newIds.push(copy.id);
          d.tasks.push(copy);
        }
        normaliseOrders(d.tasks);
      });
      set({ selectedTaskIds: new Set(newIds) });
    },

    copySelected() {
      const ids = get().selectedTaskIds;
      const tasks = get().derived.project.tasks.filter((t) => ids.has(t.id));
      set({ clipboard: { tasks: structuredClone(tasks) } });
    },

    paste() {
      const clip = get().clipboard;
      if (!clip || clip.tasks.length === 0) return;
      const newIds: TaskId[] = [];
      commit((d) => {
        // Place pasted copies at the end of the root sibling group, preserving
        // their relative order. Copies inherit the originals' `order` from the
        // clone; without fresh values they'd interleave with existing rows at
        // matching order positions (scattered, non-consecutive paste).
        const maxRootOrder = d.tasks
          .filter((t) => t.parentId === null)
          .reduce((m, t) => Math.max(m, t.order), -1);
        const ordered = [...clip.tasks].sort((a, b) => a.order - b.order);
        ordered.forEach((t, i) => {
          const copy: Task = {
            ...structuredClone(t),
            id: nanoid(10),
            parentId: null,
            order: maxRootOrder + 1 + i,
          };
          newIds.push(copy.id);
          d.tasks.push(copy);
        });
        normaliseOrders(d.tasks);
      });
      set({ selectedTaskIds: new Set(newIds) });
    },

    importTsvTasks(text) {
      const dataRows = parseTsvDataRows(text);
      if (dataRows.length === 0) return;
      const newIds: TaskId[] = [];
      commit((d) => {
        const baseOrder = d.tasks.length;
        dataRows.forEach((cols, i) => {
          const [rawName, rawStart, rawEnd] = cols;
          // 4-col legacy: name,start,end,progress
          // 6-col new:    name,start,end,duration(skip),progress,priority
          const rawProgress = cols.length >= 5 ? cols[4] : cols[3];
          const rawPriority = cols.length >= 6 ? cols[5] : undefined;
          const name = (rawName || '새 작업').slice(0, 200);
          const isValidISO = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
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
            durationDays: Math.max(1, diffDaysISO(startDate, endDate) + 1),
            progress,
            priority,
            assigneeIds: [],
            notes: '',
            isMilestone: false,
            collapsed: false,
            constraint: 'asap',
            constraintDate: null,
            manuallyScheduled: !!(isValidISO(rawStart) && isValidISO(rawEnd)),
            order: baseOrder + i,
            color: null,
            cancelled: false,
          });
        });
      });
      set({ selectedTaskIds: new Set(newIds) });
    },

    insertTsvTasks(afterId, text) {
      const dataRows = parseTsvDataRows(text);
      if (dataRows.length === 0) return 0;
      const newIds: TaskId[] = [];
      commit((d) => {
        const ref = afterId ? d.tasks.find((x) => x.id === afterId) : undefined;
        // New rows become siblings of the reference task (or root-level when
        // appending), inserted right after it.
        const parentId = ref?.parentId ?? null;
        const insertOrder = ref ? ref.order + 1 : d.tasks.filter((t) => t.parentId === parentId).length;
        // Shift later siblings down to make room for the inserted block.
        for (const t of d.tasks) {
          if (t.parentId === parentId && t.order >= insertOrder) t.order += dataRows.length;
        }
        dataRows.forEach((cols, i) => {
          const [rawName, rawStart, rawEnd] = cols;
          const rawProgress = cols.length >= 5 ? cols[4] : cols[3];
          const rawPriority = cols.length >= 6 ? cols[5] : undefined;
          const name = (rawName || '새 작업').slice(0, 200);
          const isValidISO = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
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
            durationDays: Math.max(1, diffDaysISO(startDate, endDate) + 1),
            progress,
            priority,
            assigneeIds: [],
            notes: '',
            isMilestone: false,
            collapsed: false,
            constraint: 'asap',
            constraintDate: null,
            manuallyScheduled: !!(isValidISO(rawStart) && isValidISO(rawEnd)),
            order: insertOrder + i,
            color: null,
            cancelled: false,
          });
        });
      });
      set({ selectedTaskIds: new Set(newIds) });
      return newIds.length;
    },

    updateTasksFromTsv(taskIds, tsvText) {
      const dataRows = parseTsvDataRows(tsvText);
      if (dataRows.length === 0 || taskIds.length === 0) return;
      commit((d) => {
        taskIds.forEach((id, i) => {
          const cols = dataRows[i];
          if (!cols) return;
          const task = d.tasks.find((t) => t.id === id);
          if (!task) return;
          const [rawName, rawStart, rawEnd] = cols;
          const rawProgress = cols.length >= 5 ? cols[4] : cols[3];
          const rawPriority = cols.length >= 6 ? cols[5] : undefined;
          const isValidISO = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
          if (rawName?.trim()) task.name = rawName.trim().slice(0, 200);
          if (isValidISO(rawStart) && isValidISO(rawEnd) && rawEnd >= rawStart) {
            task.start = rawStart;
            task.end = rawEnd;
            task.durationDays = Math.max(1, diffDaysISO(rawStart, rawEnd) + 1);
            task.manuallyScheduled = true;
          } else if (isValidISO(rawStart)) {
            const delta = diffDaysISO(task.start, rawStart);
            task.start = rawStart;
            task.end = addDaysISO(task.end, delta);
            task.manuallyScheduled = true;
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
    },

    batchUpdateTasks(updates) {
      if (updates.length === 0) return;
      commit((d) => {
        const norm = (v: string) =>
          /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : v;
        for (const { id, patch } of updates) {
          const t = d.tasks.find((x) => x.id === id);
          if (!t) continue;
          const normalized: Partial<Task> = { ...patch };
          if (typeof normalized.start === 'string') normalized.start = norm(normalized.start);
          if (typeof normalized.end   === 'string') normalized.end   = norm(normalized.end);
          Object.assign(t, normalized);
          if (t.start > t.end) t.end = t.start;
          if (patch.start !== undefined || patch.end !== undefined) t.manuallyScheduled = true;
        }
      });
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
      const newDerived = recalc(prev);
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
      const newDerived = recalc(next);
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
    setGridWidth(width) {
      set((s) => ({ view: { ...s.view, gridWidth: Math.max(240, Math.min(900, width)) } }));
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
