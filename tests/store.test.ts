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

  it('deletes selected tasks together with their dependencies', () => {
    const store = useProjectStore.getState();
    const leaf = store.derived.project.tasks.find((t) => t.parentId && !t.isMilestone)!;
    const before = store.derived.project.tasks.length;
    useProjectStore.getState().selectTask(leaf.id);
    useProjectStore.getState().deleteSelected();
    const after = useProjectStore.getState().derived.project;
    expect(after.tasks.length).toBeLessThan(before);
    expect(after.dependencies.some((d) => d.fromId === leaf.id || d.toId === leaf.id)).toBe(false);
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
