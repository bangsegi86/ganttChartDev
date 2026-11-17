import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@/entities';
import { createDemoProject } from './fixtures/sampleData';

vi.mock('@/shared/bridge', () => ({
  bridge: () => ({ autosave: { write: vi.fn(), read: vi.fn(), clear: vi.fn() } }),
  isElectron: () => false,
}));

import { useProjectStore } from '@/app/store/useProjectStore';
import { buildVisibleRows } from '@/features/grid/treeModel';

const T = (id: string, parentId: string | null, order: number, extra: Partial<Task> = {}): Task => ({
  id, parentId, name: id, start: '2026-11-02', end: '2026-11-06', durationDays: 5, progress: 0,
  priority: 'medium', assigneeIds: [], notes: '', isMilestone: false, collapsed: false,
  constraint: 'asap', constraintDate: null, manuallyScheduled: false, order, color: null,
  cancelled: false, ...extra,
}) as Task;

/** Outline of the project as "id(parent)" in display order. */
const outline = () =>
  buildVisibleRows(useProjectStore.getState().derived.project.tasks, { includeCollapsed: true })
    .map((r) => `${'  '.repeat(r.depth)}${r.task.name}`);
const s = () => useProjectStore.getState();

beforeEach(() => {
  // A: a1, a2(sub: a2x, a2y)   B: b1, b2   L (leaf with a link to b1)
  const p = createDemoProject();
  p.tasks = [
    T('A', null, 0), T('a1', 'A', 0), T('a2', 'A', 1), T('a2x', 'a2', 0), T('a2y', 'a2', 1),
    T('B', null, 1), T('b1', 'B', 0), T('b2', 'B', 1),
    T('L', null, 2),
  ];
  p.dependencies = [
    { id: 'd1', fromId: 'a2x', toId: 'a2y', type: 'FS', lagDays: 0 },
    { id: 'd2', fromId: 'L', toId: 'b1', type: 'FS', lagDays: 0 },
  ];
  p.viewGroups = [];
  s().loadProject(p);
});

describe('duplicate', () => {
  it('copies a group with all children and its inner links, right below it', () => {
    s().duplicateTasks(['a2']);
    expect(outline()).toEqual([
      'A', '  a1', '  a2', '    a2x', '    a2y', '  a2', '    a2x', '    a2y',
      'B', '  b1', '  b2', 'L',
    ]);
    const deps = s().derived.project.dependencies;
    expect(deps).toHaveLength(3);
    const copyX = s().derived.project.tasks.filter((t) => t.name === 'a2x').map((t) => t.id);
    expect(deps.some((d) => d.fromId === copyX[1] || d.fromId === copyX[0])).toBe(true);
  });

  it('copies a group once even when its children are also selected', () => {
    s().setSelectedTaskIds(new Set(['a2', 'a2x']));
    s().duplicateSelected();
    expect(outline().filter((l) => l.trim() === 'a2x')).toHaveLength(2);
    expect(outline().filter((l) => l.trim() === 'a2')).toHaveLength(2);
  });

  it('is undone in one step', () => {
    s().duplicateTasks(['A', 'B']);
    expect(s().derived.project.tasks).toHaveLength(9 + 5 + 3);
    s().undo();
    expect(s().derived.project.tasks).toHaveLength(9);
  });
});

describe('cut & paste (moveTasks)', () => {
  it('keeps on-screen order when moving rows from different groups', () => {
    // b1 has order 0, a2 has order 1 — but a2 is above b1 on screen.
    expect(s().moveTasks(['b1', 'a2'], 'L', null)).toBeNull();
    expect(outline()).toEqual([
      'A', '  a1', 'B', '  b2', 'L', '  a2', '    a2x', '    a2y', '  b1',
    ]);
  });

  it('inserts right below the target row, at its level', () => {
    expect(s().moveTasks(['b2'], 'A', 'a1')).toBeNull();
    expect(outline().slice(0, 4)).toEqual(['A', '  a1', '  b2', '  a2']);
  });

  it('a child moving with its cut parent is not moved separately', () => {
    s().moveTasks(['a2', 'a2y'], 'B', null);
    expect(outline()).toEqual(['A', '  a1', 'B', '  b1', '  b2', '  a2', '    a2x', '    a2y', 'L']);
  });

  it('refuses to move a group into its own child, with a reason', () => {
    const err = s().moveTasks(['A'], 'a2', null);
    expect(err).toContain('자기 하위 작업 안으로는 옮길 수 없습니다');
    expect(s().past).toHaveLength(0);
  });

  it('expands a collapsed destination so the moved rows are visible', () => {
    s().toggleCollapse('B');
    s().moveTasks(['a1'], 'B', null);
    expect(s().derived.project.tasks.find((t) => t.id === 'B')!.collapsed).toBe(false);
  });

  it('keeps links attached to moved tasks', () => {
    s().moveTasks(['b1'], 'A', null);
    expect(s().derived.project.dependencies.find((d) => d.id === 'd2')).toBeTruthy();
  });
});

describe('group selected / indent', () => {
  it('refuses to group tasks from different groups', () => {
    s().setSelectedTaskIds(new Set(['a1', 'b1']));
    s().groupSelectedTasks();
    expect(s().past).toHaveLength(0);
    expect(s().view.appToast?.msg).toContain('서로 다른 그룹');
  });

  it('keeps sub-structure when grouping a group with a sibling', () => {
    s().setSelectedTaskIds(new Set(['a1', 'a2', 'a2x']));
    s().groupSelectedTasks();
    expect(outline().slice(0, 6)).toEqual(['A', '  새 그룹', '    a1', '    a2', '      a2x', '      a2y']);
  });

  it('warns when indenting turns a linked task into a group', () => {
    s().addTask('L'); // new task right below L
    const newId = [...s().selectedTaskIds][0]!;
    s().indentTask(newId);
    expect(s().view.appToast?.msg).toContain("'L'이(가) 그룹이 되었습니다");
    expect(s().view.appToast?.msg).toContain('연결 1개');
  });
});

describe('insert right below a row', () => {
  it('below an expanded group title, new rows become its first children', () => {
    s().addTask('A');
    expect(outline().slice(0, 3)).toEqual(['A', '  새 작업', '  a1']);
    s().insertTsvTasks('B', '가\t2026-11-02\t2026-11-03\n나\t2026-11-02\t2026-11-03');
    const o = outline();
    expect(o.slice(o.indexOf('B'), o.indexOf('B') + 5)).toEqual(['B', '  가', '  나', '  b1', '  b2']);
  });

  it('below a collapsed group, new rows go after the whole group', () => {
    s().toggleCollapse('A');
    s().addTask('A');
    expect(outline().slice(0, 6)).toEqual(['A', '  a1', '  a2', '    a2x', '    a2y', '새 작업']);
  });
});
