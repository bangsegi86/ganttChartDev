import { describe, expect, it } from 'vitest';
import {
  buildAdjacency,
  leafTasks,
  topologicalOrder,
  wouldCreateCycle,
} from '@/services/dependency/graph';
import type { Dependency, Task } from '@/entities';

function task(id: string, parentId: string | null = null): Task {
  return {
    id,
    parentId,
    name: id,
    start: '2025-01-06',
    end: '2025-01-06',
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
    order: 0,
    color: null,
  };
}

const link = (from: string, to: string): Dependency => ({
  id: `${from}-${to}`,
  fromId: from,
  toId: to,
  type: 'FS',
  lagDays: 0,
});

describe('dependency graph', () => {
  it('builds predecessor/successor adjacency', () => {
    const adj = buildAdjacency([link('a', 'b'), link('a', 'c')]);
    expect(adj.successors.get('a')?.length).toBe(2);
    expect(adj.predecessors.get('b')?.length).toBe(1);
  });

  it('topologically orders a DAG', () => {
    const { order, cyclic } = topologicalOrder(['a', 'b', 'c'], [link('a', 'b'), link('b', 'c')]);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(cyclic).toHaveLength(0);
  });

  it('reports tasks that lie on a cycle', () => {
    const { cyclic } = topologicalOrder(['a', 'b'], [link('a', 'b'), link('b', 'a')]);
    expect(cyclic.sort()).toEqual(['a', 'b']);
  });

  it('detects cycles before they are added', () => {
    const deps = [link('a', 'b'), link('b', 'c')];
    expect(wouldCreateCycle(deps, 'c', 'a')).toBe(true);
    expect(wouldCreateCycle(deps, 'a', 'c')).toBe(false);
    expect(wouldCreateCycle(deps, 'a', 'a')).toBe(true);
  });

  it('identifies leaf tasks only', () => {
    const tasks = [task('p'), task('c1', 'p'), task('c2', 'p'), task('solo')];
    const leaves = leafTasks(tasks).map((t) => t.id).sort();
    expect(leaves).toEqual(['c1', 'c2', 'solo']);
  });
});
