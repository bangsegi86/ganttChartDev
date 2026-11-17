import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@/entities';
import { createDemoProject } from '@/data/sampleData';
import { scheduleProject } from '@/services/scheduler/scheduleEngine';
import { topologicalOrder } from '@/services/dependency/graph';
import { buildVisibleRows, filterRowsByName } from '@/features/grid/treeModel';

const autosaveWrite = vi.fn();
vi.mock('@/shared/bridge', () => ({
  bridge: () => ({
    persistence: { save: vi.fn(), load: vi.fn(), list: vi.fn(), delete: vi.fn() },
    autosave: { write: autosaveWrite, read: vi.fn(), clear: vi.fn() },
    export: { saveBinary: vi.fn() },
  }),
  isElectron: () => false,
}));

function task(id: string, parentId: string | null, start: string, end: string, order = 0): Task {
  return {
    id, parentId, name: id, start, end, durationDays: 1, progress: 0, isMilestone: false,
    assigneeIds: [], constraint: 'asap', constraintDate: null, manuallyScheduled: true,
    order, color: null, collapsed: false, cancelled: false,
  } as unknown as Task;
}

describe('scheduler roll-up', () => {
  it('aggregates three nesting levels deepest-first', () => {
    const project = createDemoProject();
    project.dependencies = [];
    project.tasks = [
      task('root', null, '2026-01-05', '2026-01-05'),
      task('mid', 'root', '2026-01-05', '2026-01-05'),
      task('leafA', 'mid', '2026-01-06', '2026-01-07', 0),
      task('leafB', 'mid', '2026-01-12', '2026-01-14', 1),
      task('leafC', 'root', '2026-01-20', '2026-01-21', 1),
    ];
    const { tasks } = scheduleProject(project);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    expect(byId.get('mid')).toMatchObject({ start: '2026-01-06', end: '2026-01-14' });
    expect(byId.get('root')).toMatchObject({ start: '2026-01-06', end: '2026-01-21' });
  });
});

describe('topologicalOrder', () => {
  it('orders a chain and reports cycles', () => {
    const deps = [
      { id: '1', fromId: 'a', toId: 'b', type: 'FS', lagDays: 0 },
      { id: '2', fromId: 'c', toId: 'd', type: 'FS', lagDays: 0 },
      { id: '3', fromId: 'd', toId: 'c', type: 'FS', lagDays: 0 },
    ] as const;
    const { order, cyclic } = topologicalOrder(['a', 'b', 'c', 'd'], [...deps]);
    expect(order).toEqual(['a', 'b']);
    expect(cyclic.sort()).toEqual(['c', 'd']);
  });
});

describe('filterRowsByName', () => {
  it('re-indexes filtered rows so grid and gantt rows line up', () => {
    const rows = buildVisibleRows([
      task('x', null, '2026-01-05', '2026-01-05', 0),
      task('설계', null, '2026-01-05', '2026-01-05', 1),
      task('y', null, '2026-01-05', '2026-01-05', 2),
      task('설계 검토', null, '2026-01-05', '2026-01-05', 3),
    ]);
    const out = filterRowsByName(rows, ' 설계 ');
    expect(out.map((r) => [r.task.id, r.index])).toEqual([['설계', 0], ['설계 검토', 1]]);
    expect(filterRowsByName(rows, '')).toBe(rows);
  });
});

describe('autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    autosaveWrite.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('still saves within a minute while the user keeps editing', async () => {
    const { useProjectStore } = await import('@/app/store/useProjectStore');
    useProjectStore.getState().loadProject(createDemoProject());
    const id = useProjectStore.getState().derived.project.tasks[1]!.id;
    for (let i = 0; i < 5; i++) {
      useProjectStore.getState().updateTask(id, { progress: i * 10 });
      await vi.advanceTimersByTimeAsync(20_000);
    }
    // 100s of continuous edits every 20s: a debounce would never have fired.
    expect(autosaveWrite).toHaveBeenCalled();
  });
});

describe('store structural sharing + collapse', () => {
  it('re-uses unchanged task objects and keeps collapse out of history', async () => {
    const { useProjectStore } = await import('@/app/store/useProjectStore');
    useProjectStore.getState().loadProject(createDemoProject());
    const before = useProjectStore.getState().derived.project.tasks;
    const leaf = before.find((t) => t.parentId && !before.some((c) => c.parentId === t.id))!;

    useProjectStore.getState().updateTask(leaf.id, { name: '이름만 변경' });
    const after = useProjectStore.getState().derived.project.tasks;
    const untouched = after.filter((t) => t.id !== leaf.id);
    expect(untouched.every((t) => before.includes(t))).toBe(true);
    expect(after.find((t) => t.id === leaf.id)!.name).toBe('이름만 변경');

    const parent = after.find((t) => after.some((c) => c.parentId === t.id))!;
    const pastLen = useProjectStore.getState().past.length;
    useProjectStore.getState().toggleCollapse(parent.id);
    expect(useProjectStore.getState().past.length).toBe(pastLen);
    const collapsed = useProjectStore.getState().derived.project.tasks.find((t) => t.id === parent.id)!.collapsed;
    expect(collapsed).toBe(!parent.collapsed);

    // Undoing the rename must not undo the collapse.
    useProjectStore.getState().undo();
    const s = useProjectStore.getState().derived.project.tasks;
    expect(s.find((t) => t.id === leaf.id)!.name).toBe(leaf.name);
    expect(s.find((t) => t.id === parent.id)!.collapsed).toBe(collapsed);
  });

  it('does not record a no-op edit', async () => {
    const { useProjectStore } = await import('@/app/store/useProjectStore');
    useProjectStore.getState().loadProject(createDemoProject());
    useProjectStore.getState().updateTask('does-not-exist', { name: 'x' });
    expect(useProjectStore.getState().past.length).toBe(0);
    expect(useProjectStore.getState().dirty).toBe(false);
  });
});
