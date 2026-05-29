import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type {
  Baseline,
  Dependency,
  DependencyType,
  Holiday,
  Project,
  Resource,
  Task,
  TaskId,
  WorkCalendar,
} from '@/entities';
import { recalc, type DerivedSchedule } from './recalc';
import { wouldCreateCycle } from '@/services/dependency/graph';
import { autosaveRepository, projectRepository } from '@/services/persistence/projectRepository';
import { addDaysISO, diffDaysISO } from '@/shared/date/dateUtils';
import type { ZoomLevel } from '@/features/gantt/zoom';
import { stepZoom } from '@/features/gantt/zoom';

const HISTORY_LIMIT = 100; // ≥100 undo steps as required.
const AUTOSAVE_INTERVAL_MS = 60_000; // 1-minute autosave.

export type ThemeMode = 'light' | 'dark';
export type ActiveView = 'gantt' | 'resources' | 'calendar';

interface ViewState {
  theme: ThemeMode;
  zoom: ZoomLevel;
  showCriticalPath: boolean;
  showBaseline: boolean;
  /** Left grid pane width in pixels (resizable split). */
  gridWidth: number;
  activeView: ActiveView;
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
  // --- view ---
  view: ViewState;
  dirty: boolean;
  recoveryAvailable: boolean;

  // --- lifecycle ---
  loadProject: (project: Project) => void;
  saveProject: () => Promise<void>;
  flushAutosave: () => Promise<void>;

  // --- task mutations ---
  updateTask: (id: TaskId, patch: Partial<Task>) => void;
  addTask: (afterId?: TaskId) => void;
  deleteSelected: () => void;
  toggleCollapse: (id: TaskId) => void;
  indentTask: (id: TaskId) => void;
  outdentTask: (id: TaskId) => void;
  moveTaskBy: (id: TaskId, deltaDays: number) => void;
  resizeTask: (id: TaskId, edge: 'start' | 'end', deltaDays: number) => void;
  duplicateSelected: () => void;
  copySelected: () => void;
  paste: () => void;

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

  // --- history ops ---
  undo: () => void;
  redo: () => void;

  // --- selection ---
  selectTask: (id: TaskId, additive?: boolean) => void;
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
  };
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
    dirty: false,
    recoveryAvailable: false,
    view: {
      theme: 'dark',
      zoom: 'day',
      showCriticalPath: true,
      showBaseline: false,
      gridWidth: 460,
      activeView: 'gantt',
    },

    loadProject(project) {
      const derived = recalc(project);
      set({
        derived,
        project: derived.project,
        past: [],
        future: [],
        selectedTaskIds: new Set(),
        dirty: false,
      });
    },

    async saveProject() {
      await projectRepository.save(get().derived.project);
      await autosaveRepository.clear();
      set({ dirty: false });
    },

    async flushAutosave() {
      await autosaveRepository.write(get().derived.project);
    },

    // --- task mutations ---
    updateTask(id, patch) {
      commit((d) => {
        const t = d.tasks.find((x) => x.id === id);
        if (!t) return;
        Object.assign(t, patch);
        // Editing dates directly implies a manual pin unless cleared.
        if (patch.start || patch.end) t.manuallyScheduled = true;
      });
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
        });
      });
      set({ selectedTaskIds: new Set([id]), editingTaskId: id });
    },

    deleteSelected() {
      const ids = get().selectedTaskIds;
      if (ids.size === 0) return;
      commit((d) => {
        // Collect descendants of selected tasks too.
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
      set({ selectedTaskIds: new Set() });
    },

    toggleCollapse(id) {
      commit((d) => {
        const t = d.tasks.find((x) => x.id === id);
        if (t) t.collapsed = !t.collapsed;
      });
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
        t.manuallyScheduled = true;
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
        for (const t of clip.tasks) {
          const copy: Task = { ...structuredClone(t), id: nanoid(10), parentId: null };
          newIds.push(copy.id);
          d.tasks.push(copy);
        }
        normaliseOrders(d.tasks);
      });
      set({ selectedTaskIds: new Set(newIds) });
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
  };
});

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
