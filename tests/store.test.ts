import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectStore } from '@/app/store/useProjectStore';
import { createDemoProject } from '@/data/sampleData';

// The store persists via the bridge; stub it so tests don't touch storage.
vi.mock('@/shared/bridge', () => ({
  bridge: () => ({
    persistence: { save: vi.fn(), load: vi.fn(), list: vi.fn(), delete: vi.fn() },
    autosave: { write: vi.fn(), read: vi.fn(), clear: vi.fn() },
    export: { saveBinary: vi.fn() },
  }),
  isElectron: () => false,
}));

describe('project store (integration)', () => {
  beforeEach(() => {
    useProjectStore.getState().loadProject(createDemoProject());
  });

  it('records and reverses edits through undo/redo', () => {
    const store = useProjectStore.getState();
    const target = store.derived.project.tasks.find((t) => !t.collapsed && t.parentId)!;
    const originalName = target.name;

    store.updateTask(target.id, { name: '변경된 작업' });
    expect(currentTask(target.id).name).toBe('변경된 작업');

    useProjectStore.getState().undo();
    expect(currentTask(target.id).name).toBe(originalName);

    useProjectStore.getState().redo();
    expect(currentTask(target.id).name).toBe('변경된 작업');
  });

  it('keeps at least 100 undo steps available', () => {
    const id = useProjectStore.getState().derived.project.tasks[1]!.id;
    for (let i = 0; i < 120; i++) {
      useProjectStore.getState().updateTask(id, { progress: i % 100 });
    }
    // History is capped at 100 — older steps drop off, newest are retained.
    expect(useProjectStore.getState().past.length).toBe(100);
  });

  it('adds a dependency and rejects ones that would create a cycle', () => {
    // 'plan-1' reaches 'qa-2' through the demo chain but has no direct link.
    const ok = useProjectStore.getState().addDependency('plan-1', 'qa-2', 'FS');
    expect(ok).toBe(true);
    // The reverse link would close a cycle and must be refused.
    const bad = useProjectStore.getState().addDependency('qa-2', 'plan-1', 'FS');
    expect(bad).toBe(false);
  });

  it('soft-deletes (cancels) selected tasks on first delete, then hard-deletes on confirmation', () => {
    const store = useProjectStore.getState();
    const leaf = store.derived.project.tasks.find((t) => t.parentId && !t.isMilestone)!;
    const before = store.derived.project.tasks.length;

    // First delete → cancels the task, does NOT remove it.
    useProjectStore.getState().selectTask(leaf.id);
    useProjectStore.getState().deleteSelected();
    const afterCancel = useProjectStore.getState().derived.project;
    expect(afterCancel.tasks.length).toBe(before);
    expect(afterCancel.tasks.find((t) => t.id === leaf.id)!.cancelled).toBe(true);

    // Second delete (task is already cancelled) → sets confirmDeletePending.
    useProjectStore.getState().selectTask(leaf.id);
    useProjectStore.getState().deleteSelected();
    expect(useProjectStore.getState().confirmDeletePending).toBe(true);

    // Confirming hard-delete → removes task and its dependencies.
    useProjectStore.getState().hardDeleteSelected();
    const afterHard = useProjectStore.getState().derived.project;
    expect(afterHard.tasks.length).toBeLessThan(before);
    expect(afterHard.dependencies.some((d) => d.fromId === leaf.id || d.toId === leaf.id)).toBe(false);
    expect(useProjectStore.getState().confirmDeletePending).toBe(false);
  });

  it('creates a view group from the selection and filters to it', () => {
    const store = useProjectStore.getState();
    const ids = store.derived.project.tasks.slice(0, 3).map((t) => t.id);
    const groupId = store.createViewGroup('테스트 그룹', ids);

    const created = useProjectStore.getState().derived.project.viewGroups.find((g) => g.id === groupId)!;
    expect(created.name).toBe('테스트 그룹');
    expect(created.taskIds).toHaveLength(3);

    useProjectStore.getState().setViewFilter('group', groupId);
    expect(useProjectStore.getState().view.filterMode).toBe('group');
    expect(useProjectStore.getState().view.filterGroupId).toBe(groupId);

    // Removing the active group falls back to showing everything.
    useProjectStore.getState().removeViewGroup(groupId);
    expect(useProjectStore.getState().view.filterMode).toBe('all');
    expect(useProjectStore.getState().derived.project.viewGroups.some((g) => g.id === groupId)).toBe(false);
  });

  it('snapshots the selection for "focus" filter and clears back to all', () => {
    const store = useProjectStore.getState();
    const id = store.derived.project.tasks[2]!.id;
    useProjectStore.getState().selectTask(id);
    useProjectStore.getState().setViewFilter('focus');
    expect(useProjectStore.getState().view.filterMode).toBe('focus');
    expect(useProjectStore.getState().view.focusIds).toContain(id);

    useProjectStore.getState().clearViewFilter();
    expect(useProjectStore.getState().view.filterMode).toBe('all');
  });

  it('bulk-imports tasks from pasted TSV text', () => {
    const before = useProjectStore.getState().derived.project.tasks.length;
    useProjectStore.getState().importTsvTasks('작업 A\t2026-06-01\t2026-06-05\t30\n작업 B');
    const tasks = useProjectStore.getState().derived.project.tasks;
    expect(tasks.length).toBe(before + 2);
    const a = tasks.find((t) => t.name === '작업 A')!;
    expect(a.start).toBe('2026-06-01');
    expect(a.progress).toBe(30);
  });

  it('reparents a task into another parent via moveTasks (cut → paste as child)', () => {
    // design-1 starts under 'design'; move it to become a child of 'dev'.
    expect(currentTask('design-1').parentId).toBe('design');
    useProjectStore.getState().moveTasks(['design-1'], 'dev', null);

    const moved = currentTask('design-1');
    expect(moved.parentId).toBe('dev');
    // Appended at the end of dev's children → highest order among them.
    const devChildren = useProjectStore
      .getState()
      .derived.project.tasks.filter((t) => t.parentId === 'dev');
    const maxOrder = Math.max(...devChildren.map((t) => t.order));
    expect(moved.order).toBe(maxOrder);
  });

  it('moveTasks refuses to move a task into its own descendant', () => {
    // 'design' is the parent of 'design-1'; moving design under design-1 must no-op.
    useProjectStore.getState().moveTasks(['design'], 'design-1', null);
    expect(currentTask('design').parentId).toBe(null);
    expect(currentTask('design-1').parentId).toBe('design');
  });

  it('moveTasks inserts as a sibling right after the target (paste as sibling)', () => {
    // Move design-1 to sit directly after dev-1 among dev's children.
    useProjectStore.getState().moveTasks(['design-1'], 'dev', 'dev-1');
    const devChildren = useProjectStore
      .getState()
      .derived.project.tasks
      .filter((t) => t.parentId === 'dev')
      .sort((a, b) => a.order - b.order);
    const idx = devChildren.findIndex((t) => t.id === 'dev-1');
    expect(devChildren[idx + 1]!.id).toBe('design-1');
  });

  it('captures a baseline snapshot of the current plan', () => {
    useProjectStore.getState().captureBaseline('초기 계획');
    const p = useProjectStore.getState().derived.project;
    expect(p.baselines).toHaveLength(1);
    expect(p.activeBaselineId).toBe(p.baselines[0]!.id);
    expect(p.baselines[0]!.entries.length).toBe(p.tasks.length);
  });
});

function currentTask(id: string) {
  return useProjectStore.getState().derived.project.tasks.find((t) => t.id === id)!;
}
