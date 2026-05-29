import { describe, expect, it } from 'vitest';
import { WorkingCalendar } from '@/services/scheduler/workCalendar';
import { scheduleProject } from '@/services/scheduler/scheduleEngine';
import { DEFAULT_CALENDAR, type Project, type Task } from '@/entities';
import { generateKoreanHolidays } from '@/services/holiday/koreanHolidays';

function makeTask(partial: Partial<Task> & Pick<Task, 'id'>): Task {
  return {
    parentId: null,
    name: partial.id,
    start: '2025-01-01',
    end: '2025-01-01',
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

function makeProject(tasks: Task[], dependencies: Project['dependencies']): Project {
  return {
    schemaVersion: 1,
    id: 'p1',
    name: 'test',
    startDate: '2025-01-06', // Monday
    createdAt: '',
    updatedAt: '',
    calendar: DEFAULT_CALENDAR,
    tasks,
    dependencies,
    resources: [],
    holidays: generateKoreanHolidays(2025, 2025),
    baselines: [],
    activeBaselineId: null,
  };
}

describe('WorkingCalendar', () => {
  const cal = new WorkingCalendar(DEFAULT_CALENDAR, []);

  it('treats Saturday/Sunday as non-working in working mode', () => {
    expect(cal.isWorkingDay('2025-01-04')).toBe(false); // Sat
    expect(cal.isWorkingDay('2025-01-05')).toBe(false); // Sun
    expect(cal.isWorkingDay('2025-01-06')).toBe(true); // Mon
  });

  it('computes a finish date that skips the weekend', () => {
    // Start Friday 2025-01-10, 3 working days => Fri, Mon, Tue = 2025-01-14.
    expect(cal.finishDateFor('2025-01-10', 3)).toBe('2025-01-14');
  });

  it('rolls non-working start dates forward to the next working day', () => {
    expect(cal.nextWorkingDay('2025-01-04')).toBe('2025-01-06');
  });

  it('counts working days inclusively', () => {
    // Mon..Fri = 5 working days.
    expect(cal.workingDaysBetween('2025-01-06', '2025-01-10')).toBe(5);
  });

  it('skips Korean holidays when exclude is enabled', () => {
    const withHolidays = new WorkingCalendar(
      DEFAULT_CALENDAR,
      generateKoreanHolidays(2025, 2025),
    );
    // 2025-01-01 (신정) is a Wednesday holiday.
    expect(withHolidays.isWorkingDay('2025-01-01')).toBe(false);
  });
});

describe('scheduleProject', () => {
  it('anchors a no-predecessor task to the project start', () => {
    const t = makeTask({ id: 'a', durationDays: 3 });
    const result = scheduleProject(makeProject([t], []));
    const a = result.tasks.find((x) => x.id === 'a')!;
    expect(a.start).toBe('2025-01-06');
    expect(a.end).toBe('2025-01-08');
  });

  it('places an FS successor after its predecessor finishes', () => {
    const a = makeTask({ id: 'a', durationDays: 2 }); // Mon-Tue
    const b = makeTask({ id: 'b', durationDays: 2 });
    const result = scheduleProject(
      makeProject([a, b], [
        { id: 'd1', fromId: 'a', toId: 'b', type: 'FS', lagDays: 0 },
      ]),
    );
    const sa = result.tasks.find((x) => x.id === 'a')!;
    const sb = result.tasks.find((x) => x.id === 'b')!;
    expect(sa.end).toBe('2025-01-07'); // Tue
    expect(sb.start).toBe('2025-01-08'); // Wed
  });

  it('honours FS lag in working days', () => {
    const a = makeTask({ id: 'a', durationDays: 1 }); // Mon only
    const b = makeTask({ id: 'b', durationDays: 1 });
    const result = scheduleProject(
      makeProject([a, b], [
        { id: 'd1', fromId: 'a', toId: 'b', type: 'FS', lagDays: 2 },
      ]),
    );
    const sb = result.tasks.find((x) => x.id === 'b')!;
    // a finishes Mon 01-06, +1 day => Tue, +2 lag => Thu 01-09.
    expect(sb.start).toBe('2025-01-09');
  });

  it('aligns SS successors to the predecessor start', () => {
    const a = makeTask({ id: 'a', durationDays: 5 });
    const b = makeTask({ id: 'b', durationDays: 2 });
    const result = scheduleProject(
      makeProject([a, b], [
        { id: 'd1', fromId: 'a', toId: 'b', type: 'SS', lagDays: 0 },
      ]),
    );
    const sa = result.tasks.find((x) => x.id === 'a')!;
    const sb = result.tasks.find((x) => x.id === 'b')!;
    expect(sb.start).toBe(sa.start);
  });

  it('rolls a parent summary up to span its children', () => {
    const parent = makeTask({ id: 'p' });
    const c1 = makeTask({ id: 'c1', parentId: 'p', durationDays: 2 });
    const c2 = makeTask({ id: 'c2', parentId: 'p', durationDays: 3 });
    const result = scheduleProject(
      makeProject([parent, c1, c2], [
        { id: 'd1', fromId: 'c1', toId: 'c2', type: 'FS', lagDays: 0 },
      ]),
    );
    const p = result.tasks.find((x) => x.id === 'p')!;
    const sc1 = result.tasks.find((x) => x.id === 'c1')!;
    const sc2 = result.tasks.find((x) => x.id === 'c2')!;
    expect(p.start).toBe(sc1.start);
    expect(p.end).toBe(sc2.end);
  });

  it('leaves manually scheduled tasks pinned', () => {
    const a = makeTask({ id: 'a', durationDays: 2 });
    const b = makeTask({
      id: 'b',
      durationDays: 2,
      manuallyScheduled: true,
      start: '2025-01-20',
      end: '2025-01-21',
    });
    const result = scheduleProject(
      makeProject([a, b], [
        { id: 'd1', fromId: 'a', toId: 'b', type: 'FS', lagDays: 0 },
      ]),
    );
    const sb = result.tasks.find((x) => x.id === 'b')!;
    expect(sb.start).toBe('2025-01-20');
  });
});
