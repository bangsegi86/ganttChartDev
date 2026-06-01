import { describe, expect, it } from 'vitest';
import { computeCriticalPath } from '@/services/critical-path/cpm';
import type { Dependency, Task } from '@/entities';

function task(id: string, durationDays: number, parentId: string | null = null): Task {
  return {
    id,
    parentId,
    name: id,
    start: '2025-01-06',
    end: '2025-01-06',
    durationDays,
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
    cancelled: false,
  };
}

function fs(id: string, from: string, to: string): Dependency {
  return { id, fromId: from, toId: to, type: 'FS', lagDays: 0 };
}

describe('computeCriticalPath', () => {
  it('identifies the longest path as critical', () => {
    //   A(2) -> B(4) -> D(1)
    //   A(2) -> C(1) -> D(1)
    // Critical: A -> B -> D (length 7); C has float.
    const tasks = [task('A', 2), task('B', 4), task('C', 1), task('D', 1)];
    const deps = [fs('1', 'A', 'B'), fs('2', 'A', 'C'), fs('3', 'B', 'D'), fs('4', 'C', 'D')];
    const result = computeCriticalPath(tasks, deps);

    expect(result.projectDuration).toBe(7);
    expect(result.schedules.get('A')!.isCritical).toBe(true);
    expect(result.schedules.get('B')!.isCritical).toBe(true);
    expect(result.schedules.get('D')!.isCritical).toBe(true);
    expect(result.schedules.get('C')!.isCritical).toBe(false);
  });

  it('computes positive total float for the slack task', () => {
    const tasks = [task('A', 2), task('B', 4), task('C', 1), task('D', 1)];
    const deps = [fs('1', 'A', 'B'), fs('2', 'A', 'C'), fs('3', 'B', 'D'), fs('4', 'C', 'D')];
    const result = computeCriticalPath(tasks, deps);
    // C can slip by the difference between B(4) and C(1) = 3 days.
    expect(result.schedules.get('C')!.totalFloat).toBe(3);
  });

  it('treats a single linear chain as entirely critical', () => {
    const tasks = [task('A', 1), task('B', 1), task('C', 1)];
    const deps = [fs('1', 'A', 'B'), fs('2', 'B', 'C')];
    const result = computeCriticalPath(tasks, deps);
    expect(result.criticalPath).toEqual(['A', 'B', 'C']);
    expect(result.projectDuration).toBe(3);
  });

  it('handles independent tasks with no links', () => {
    const tasks = [task('A', 3), task('B', 1)];
    const result = computeCriticalPath(tasks, []);
    // Longest task defines duration; shorter one carries float.
    expect(result.projectDuration).toBe(3);
    expect(result.schedules.get('A')!.isCritical).toBe(true);
    expect(result.schedules.get('B')!.totalFloat).toBe(2);
  });
});
