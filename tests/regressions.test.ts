import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@/entities';
import { createDemoProject } from './fixtures/sampleData';
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

describe('cancelled tasks and CPM on real dates', () => {
  const base = () => {
    const p = createDemoProject();
    p.startDate = '2026-01-05'; // Monday
    p.holidays = [];
    p.calendar = { ...p.calendar, workingWeekdays: [1, 2, 3, 4, 5], mode: 'working' };
    return p;
  };
  const leaf = (id: string, dur: number, extra: Partial<Task> = {}): Task => ({
    ...task(id, null, '2026-01-05', '2026-01-05'), manuallyScheduled: false, durationDays: dur, ...extra,
  } as Task);

  it('ignores a cancelled predecessor and leaves it out of CPM', async () => {
    const { recalc } = await import('@/app/store/recalc');
    const p = base();
    p.tasks = [leaf('A', 5, { cancelled: true }), leaf('B', 2)];
    p.dependencies = [{ id: 'd', fromId: 'A', toId: 'B', type: 'FS', lagDays: 0 }];
    const r = recalc(p);
    expect(r.project.tasks.find((t) => t.id === 'B')!.start).toBe('2026-01-05');
    expect(r.schedules.has('A')).toBe(false);
  });

  it('marks a chain pushed late by a constraint as critical', async () => {
    const { recalc } = await import('@/app/store/recalc');
    const p = base();
    // Chain X→Y is short but X is pinned (SNET) two weeks out, so it finishes
    // last; chain P→Q is longer in duration but finishes earlier.
    p.tasks = [
      leaf('P', 5), leaf('Q', 5),
      leaf('X', 1, { constraint: 'snet', constraintDate: '2026-01-19' }), leaf('Y', 1),
    ];
    p.dependencies = [
      { id: '1', fromId: 'P', toId: 'Q', type: 'FS', lagDays: 0 },
      { id: '2', fromId: 'X', toId: 'Y', type: 'FS', lagDays: 0 },
    ];
    const r = recalc(p);
    expect(r.schedules.get('X')!.isCritical).toBe(true);
    expect(r.schedules.get('Y')!.isCritical).toBe(true);
    expect(r.schedules.get('P')!.isCritical).toBe(false);
    expect(r.schedules.get('P')!.totalFloat).toBeGreaterThan(0);
  });

  it('excludes cancelled tasks from workload', async () => {
    const { computeWorkload } = await import('@/services/resource/workload');
    const p = base();
    p.resources = [{ id: 'r', name: 'r', color: '#000', capacityHoursPerDay: 8 } as never];
    p.tasks = [
      { ...task('a', null, '2026-01-05', '2026-01-09'), assigneeIds: ['r'] } as Task,
      { ...task('b', null, '2026-01-05', '2026-01-09'), assigneeIds: ['r'], cancelled: true } as Task,
    ];
    const [w] = computeWorkload(p);
    expect(w!.totalHours).toBe(40);
  });
});

describe('date edits behave like a bar drag', () => {
  it('typed start becomes SNET, typed end sets working-day duration', async () => {
    const { useProjectStore } = await import('@/app/store/useProjectStore');
    const p = createDemoProject();
    p.startDate = '2026-01-05';
    p.holidays = [];
    p.calendar = { ...p.calendar, workingWeekdays: [1, 2, 3, 4, 5], mode: 'working' };
    p.tasks = [
      { ...task('A', null, '2026-01-05', '2026-01-09'), manuallyScheduled: false, durationDays: 5 } as Task,
      { ...task('B', null, '2026-01-12', '2026-01-12', 1), manuallyScheduled: false, durationDays: 1 } as Task,
    ];
    p.dependencies = [{ id: 'd', fromId: 'A', toId: 'B', type: 'FS', lagDays: 0 }];
    useProjectStore.getState().loadProject(p);
    const get = (id: string) => useProjectStore.getState().derived.project.tasks.find((t) => t.id === id)!;

    useProjectStore.getState().updateTask('B', { start: '20260119' });
    expect(get('B')).toMatchObject({ start: '2026-01-19', constraint: 'snet', manuallyScheduled: false });

    // Predecessor now pushed past B's anchor → B follows it (a manual pin would not).
    useProjectStore.getState().updateTask('A', { end: '2026-01-23' });
    expect(get('A').durationDays).toBe(15);
    expect(get('B').start).toBe('2026-01-26');

    // Typing a start earlier than the predecessor allows is adjusted, with a notice.
    useProjectStore.getState().editTaskDate('B', 'start', '2026-01-06');
    expect(get('B').start).toBe('2026-01-26');
    expect(useProjectStore.getState().view.appToast?.msg).toContain('2026-01-26');
  });
});

describe('loading and saving', () => {
  it('repairs a malformed file instead of crashing', async () => {
    const { normalizeProject } = await import('@/app/store/normalizeProject');
    const p = normalizeProject({
      name: 'x',
      tasks: [
        { id: 'a', name: 'A', start: 'bad', parentId: 'missing' },
        { id: 'b', parentId: 'c' },
        { id: 'c', parentId: 'b' },
        { id: 'a' },
      ],
      dependencies: [{ fromId: 'a', toId: 'ghost' }, { fromId: 'a', toId: 'b', type: 'XX' }],
      calendar: { workingWeekdays: [] },
    });
    expect(p.tasks).toHaveLength(4);
    expect(new Set(p.tasks.map((t) => t.id)).size).toBe(4);
    expect(p.tasks[0]).toMatchObject({ parentId: null, assigneeIds: [], constraint: 'asap' });
    expect(p.tasks[0]!.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // b ↔ c parent cycle is broken
    const b = p.tasks.find((t) => t.id === 'b')!;
    const c = p.tasks.find((t) => t.id === 'c')!;
    expect(b.parentId === null || c.parentId === null).toBe(true);
    expect(p.dependencies).toEqual([{ id: expect.any(String), fromId: 'a', toId: 'b', type: 'FS', lagDays: 0 }]);
    expect(p.calendar.workingWeekdays).toEqual([1, 2, 3, 4, 5]);

    const { recalc } = await import('@/app/store/recalc');
    expect(() => recalc(p)).not.toThrow();
  });

  it('saving does not create an undo step', async () => {
    const { useProjectStore } = await import('@/app/store/useProjectStore');
    useProjectStore.getState().loadProject(createDemoProject());
    await useProjectStore.getState().saveProject();
    expect(useProjectStore.getState().past).toHaveLength(0);
  });
});

describe('group (summary) drag moves every child', () => {
  const setup = async () => {
    const { useProjectStore } = await import('@/app/store/useProjectStore');
    const p = createDemoProject();
    p.startDate = '2026-01-05';
    p.holidays = [];
    p.calendar = { ...p.calendar, workingWeekdays: [1, 2, 3, 4, 5], mode: 'working' };
    const leaf = (id: string, start: string, end: string, dur: number, order: number): Task =>
      ({ ...task(id, 'G', start, end, order), manuallyScheduled: false, durationDays: dur } as Task);
    p.tasks = [
      { ...task('G', null, '2026-01-05', '2026-01-05'), manuallyScheduled: false } as Task,
      leaf('c1', '2026-01-05', '2026-01-09', 5, 0),
      leaf('c2', '2026-01-12', '2026-01-14', 3, 1),
      leaf('c3', '2026-01-05', '2026-01-06', 2, 2),
    ];
    p.dependencies = [{ id: 'd', fromId: 'c1', toId: 'c2', type: 'FS', lagDays: 0 }];
    useProjectStore.getState().loadProject(p);
    const dates = () => Object.fromEntries(
      useProjectStore.getState().derived.project.tasks.map((t) => [t.id, [t.start, t.end]]),
    );
    return { store: useProjectStore, dates };
  };

  it('moves left even when the group sits at the project start', async () => {
    const { store, dates } = await setup();
    store.getState().moveSubtreeBy('G', -7);
    expect(dates()).toEqual({
      G: ['2025-12-29', '2026-01-07'],
      c1: ['2025-12-29', '2026-01-02'],
      c2: ['2026-01-05', '2026-01-07'],
      c3: ['2025-12-29', '2025-12-30'],
    });
  });

  it('moves right and keeps the internal dependency chain', async () => {
    const { store, dates } = await setup();
    store.getState().moveSubtreeBy('G', 7);
    expect(dates()).toEqual({
      G: ['2026-01-12', '2026-01-21'],
      c1: ['2026-01-12', '2026-01-16'],
      c2: ['2026-01-19', '2026-01-21'],
      c3: ['2026-01-12', '2026-01-13'],
    });
  });

  it('a single bar can also be dragged before the project start', async () => {
    const { store, dates } = await setup();
    store.getState().moveTaskBy('c3', -7);
    expect(dates().c3).toEqual(['2025-12-29', '2025-12-30']);
  });
});

describe('paste helpers: transact + appendBlankTasks', () => {
  it('appends rows at the end of a group and undoes the whole paste at once', async () => {
    const { useProjectStore } = await import('@/app/store/useProjectStore');
    const p = createDemoProject();
    p.tasks = [
      task('G', null, '2026-01-05', '2026-01-05', 0),
      task('a', 'G', '2026-01-05', '2026-01-05', 0),
      task('b', 'G', '2026-01-05', '2026-01-05', 1),
      task('H', null, '2026-01-05', '2026-01-05', 1),
    ];
    p.dependencies = [];
    useProjectStore.getState().loadProject(p);
    const s = useProjectStore.getState();
    let ids: string[] = [];
    s.transact(() => {
      s.batchUpdateTasks([{ id: 'b', patch: { name: 'B2' } }]);
      ids = s.appendBlankTasks('G', 2);
      s.batchUpdateTasks(ids.map((id, i) => ({ id, patch: { name: `new${i}` } })));
    });
    const kids = useProjectStore.getState().derived.project.tasks
      .filter((t) => t.parentId === 'G').sort((x, y) => x.order - y.order).map((t) => t.name);
    expect(kids).toEqual(['a', 'B2', 'new0', 'new1']);
    expect(useProjectStore.getState().past).toHaveLength(1);

    useProjectStore.getState().undo();
    const after = useProjectStore.getState().derived.project.tasks;
    expect(after).toHaveLength(4);
    expect(after.find((t) => t.id === 'b')!.name).toBe('b');
  });
});
