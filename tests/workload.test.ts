import { describe, expect, it } from 'vitest';
import { computeWorkload } from '@/services/resource/workload';
import { DEFAULT_CALENDAR, type Project, type Task } from '@/entities';

function task(partial: Partial<Task> & Pick<Task, 'id'>): Task {
  return {
    parentId: null,
    name: partial.id,
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
    ...partial,
  };
}

function project(tasks: Task[]): Project {
  return {
    schemaVersion: 1,
    id: 'p',
    name: 't',
    startDate: '2025-01-06',
    createdAt: '',
    updatedAt: '',
    calendar: DEFAULT_CALENDAR,
    tasks,
    dependencies: [],
    resources: [{ id: 'r1', name: 'A', role: '', color: '#000', capacityHoursPerDay: 8 }],
    holidays: [],
    baselines: [],
    activeBaselineId: null,
    viewGroups: [],
  };
}

describe('computeWorkload', () => {
  it('accumulates a full day of effort per working day', () => {
    // Mon–Fri (5 working days) × 8h = 40h.
    const t = task({ id: 't', start: '2025-01-06', end: '2025-01-10', assigneeIds: ['r1'] });
    const [w] = computeWorkload(project([t]));
    expect(Math.round(w!.totalHours)).toBe(40);
    expect(w!.peakDailyHours).toBeCloseTo(8);
    expect(w!.overloadedDays).toBe(0);
  });

  it('flags over-allocation when two tasks overlap on one resource', () => {
    const a = task({ id: 'a', start: '2025-01-06', end: '2025-01-06', assigneeIds: ['r1'] });
    const b = task({ id: 'b', start: '2025-01-06', end: '2025-01-06', assigneeIds: ['r1'] });
    const [w] = computeWorkload(project([a, b]));
    // 8h + 8h on the same day = 16h > 8h capacity.
    expect(w!.peakDailyHours).toBeCloseTo(16);
    expect(w!.overloadedDays).toBe(1);
  });

  it('ignores milestones and unassigned tasks', () => {
    const m = task({ id: 'm', isMilestone: true, assigneeIds: ['r1'] });
    const u = task({ id: 'u', assigneeIds: [] });
    const [w] = computeWorkload(project([m, u]));
    expect(w!.totalHours).toBe(0);
  });
});
