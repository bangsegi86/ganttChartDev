import { describe, expect, it, vi } from 'vitest';
import { parseDateInput } from '@/shared/date/parseDateInput';
import { todayISO, addDaysISO } from '@/shared/date/dateUtils';
import type { Task } from '@/entities';
import { createDemoProject } from './fixtures/sampleData';

vi.mock('@/shared/bridge', () => ({
  bridge: () => ({ autosave: { write: vi.fn(), read: vi.fn(), clear: vi.fn() } }),
  isElectron: () => false,
}));

describe('parseDateInput', () => {
  it.each([
    ['20261130', '2026-11-30'],
    ['261130', '2026-11-30'],
    ['2026-11-30', '2026-11-30'],
    ['2026-11-5', '2026-11-05'],
    ['2026.11.30', '2026-11-30'],
    ['2026.11.30.', '2026-11-30'],
    ['2026/11/30', '2026-11-30'],
    ['2026 11 30', '2026-11-30'],
    ['2026년 11월 30일', '2026-11-30'],
    ['26.11.30', '2026-11-30'],
    ['11/30', '2026-11-30'],
    ['11-30', '2026-11-30'],
    ['11월 30일', '2026-11-30'],
    ['1130', '2026-11-30'],
    ['2028-02-29', '2028-02-29'],
  ])('accepts %s', (input, iso) => {
    expect(parseDateInput(input, 2026)).toEqual({ ok: true, iso });
  });

  it('understands 오늘 / 내일 / 어제', () => {
    expect(parseDateInput('오늘')).toEqual({ ok: true, iso: todayISO() });
    expect(parseDateInput('내일')).toEqual({ ok: true, iso: addDaysISO(todayISO(), 1) });
  });

  it.each([
    ['2026-13-40', '13월은 없습니다'],
    ['2026-02-30', '2월에는 30일이 없습니다. 2월은 28일까지'],
    ['2027-02-29', '2월은 28일까지'],
    ['2026-04-31', '4월은 30일까지'],
    ['abc', '날짜로 알아볼 수 없습니다'],
    ['2026-11', '날짜로 알아볼 수 없습니다'],
    ['1800-01-01', '1900년부터'],
    ['', '비어 있습니다'],
  ])('rejects %s with a clear reason', (input, reason) => {
    const r = parseDateInput(input, 2026);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain(reason);
  });
});

describe('editTaskDate', () => {
  const T = (id: string, parentId: string | null, start: string, end: string, dur: number, order = 0, extra: Partial<Task> = {}) => ({
    id, parentId, name: id, start, end, durationDays: dur, progress: 0, priority: 'medium', assigneeIds: [], notes: '',
    isMilestone: false, collapsed: false, constraint: 'asap', constraintDate: null, manuallyScheduled: false,
    order, color: null, cancelled: false, ...extra,
  }) as Task;
  const setup = async () => {
    const { useProjectStore } = await import('@/app/store/useProjectStore');
    const p = createDemoProject();
    p.startDate = '2026-11-02';
    p.holidays = [];
    p.calendar = { ...p.calendar, workingWeekdays: [1, 2, 3, 4, 5], mode: 'working' };
    p.tasks = [
      T('G', null, '2026-11-02', '2026-11-06', 5, 0),
      T('A', 'G', '2026-11-02', '2026-11-06', 5, 0),
      T('B', 'G', '2026-11-09', '2026-11-13', 5, 1),
      T('M', null, '2026-11-02', '2026-11-02', 0, 1, { isMilestone: true }),
    ];
    p.dependencies = [{ id: 'd', fromId: 'A', toId: 'B', type: 'FS', lagDays: 0 }];
    useProjectStore.getState().loadProject(p);
    const s = () => useProjectStore.getState();
    const get = (id: string) => s().derived.project.tasks.find((t) => t.id === id)!;
    return { s, get };
  };

  it('a new start moves the task and keeps its duration', async () => {
    const { s, get } = await setup();
    expect(s().editTaskDate('A', 'start', '20261110')).toBe(true);
    expect(get('A')).toMatchObject({ start: '2026-11-10', end: '2026-11-16', durationDays: 5 });
  });

  it('rejects an impossible date without changing anything', async () => {
    const { s, get } = await setup();
    expect(s().editTaskDate('A', 'start', '2026-13-40')).toBe(false);
    expect(get('A')).toMatchObject({ start: '2026-11-02', end: '2026-11-06' });
    expect(s().view.appToast?.msg).toContain('13월은 없습니다');
    expect(s().past).toHaveLength(0);
  });

  it('rejects an end before the start', async () => {
    const { s, get } = await setup();
    expect(s().editTaskDate('A', 'end', '2026-10-30')).toBe(false);
    expect(get('A').end).toBe('2026-11-06');
    expect(s().view.appToast?.msg).toContain('시작일 2026-11-02(월)보다 빠릅니다');
  });

  it('explains a start pushed by a predecessor and keeps the duration', async () => {
    const { s, get } = await setup();
    s().editTaskDate('B', 'start', '2026-11-04');
    expect(get('B')).toMatchObject({ start: '2026-11-09', end: '2026-11-13', durationDays: 5 });
    expect(s().view.appToast?.msg).toContain("'A'이(가) 끝난 뒤에 시작");
  });

  it('explains weekend adjustments', async () => {
    const { s, get } = await setup();
    s().editTaskDate('A', 'start', '2026-11-07'); // Saturday
    expect(get('A').start).toBe('2026-11-09');
    expect(s().view.appToast?.msg).toContain('쉬는 날이라 다음 근무일 2026-11-09(월)');
    s().editTaskDate('A', 'end', '2026-11-15'); // Sunday
    expect(get('A').end).toBe('2026-11-13');
    expect(s().view.appToast?.msg).toContain('바로 앞 근무일 2026-11-13(금)');
  });

  it('moves a whole group when its start is typed, refuses its end', async () => {
    const { s, get } = await setup();
    expect(s().editTaskDate('G', 'end', '2026-12-01')).toBe(false);
    expect(s().view.appToast?.msg).toContain('그룹이라 종료일이');
    expect(s().editTaskDate('G', 'start', '2026-11-09')).toBe(true);
    expect(get('A').start).toBe('2026-11-09');
    expect(get('B').start).toBe('2026-11-16');
    expect(s().view.appToast?.msg).toContain('하위 작업 2개와 함께 7일 뒤로');
  });

  it('refuses an end date on a milestone', async () => {
    const { s } = await setup();
    expect(s().editTaskDate('M', 'end', '2026-11-05')).toBe(false);
    expect(s().view.appToast?.msg).toContain('마일스톤');
  });
});
