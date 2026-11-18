import { describe, expect, it } from 'vitest';
import { parseHolidayBulk } from '@/features/dialogs/holidayBulk';
import { makeHoliday } from '@/entities';

const opt = { defaultKind: 'company' as const, skipWeekends: true, baseYear: 2026 };

describe('parseHolidayBulk', () => {
  it('reads Excel (tab), comma and space separated lines with kinds', () => {
    const rows = parseHolidayBulk([
      '날짜\t이름\t유형',
      '2026-12-25\t성탄절\t공휴일',
      '2026-04-15, 창립기념일, 회사',
      '10/2 임시 공휴일',
      '2026.05.25 부처님오신날 대체',
    ].join('\n'), [], opt);
    expect(rows.map((r) => r.status)).toEqual(['add', 'add', 'add', 'add']);
    const hs = rows.flatMap((r) => r.holidays);
    expect(hs.map((h) => [h.date, h.name, h.kind])).toEqual([
      ['2026-12-25', '성탄절', 'public'],
      ['2026-04-15', '창립기념일', 'company'],
      ['2026-10-02', '임시 공휴일', 'company'], // no explicit kind: default kind
      ['2026-05-25', '부처님오신날', 'substitute'],
    ]);
  });

  it('expands ranges and leaves weekends out', () => {
    const [r] = parseHolidayBulk('2026-12-24~2026-12-31\t연말 휴무\t회사', [], opt);
    // 24 Thu, 25 Fri, 28 Mon, 29 Tue, 30 Wed, 31 Thu (26/27 weekend skipped)
    expect(r!.holidays.map((h) => h.date)).toEqual(['2026-12-24', '2026-12-25', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31']);
    expect(r!.message).toContain('6일');
  });

  it('explains every bad line and keeps going', () => {
    const rows = parseHolidayBulk([
      '2026-13-01\t잘못된 달',
      '2026-02-30\t없는 날',
      '2026-12-31~2026-12-01\t거꾸로',
      '2026-12-25\t성탄절\t반차',
      '휴가',
      '2026-12-26~2026-12-27\t주말뿐',
      '2026-07-17\t제헌절',
    ].join('\n'), [], opt);
    expect(rows.map((r) => r.status)).toEqual(['error', 'error', 'error', 'error', 'error', 'error', 'add']);
    expect(rows[0]!.message).toContain('13월은 없습니다');
    expect(rows[1]!.message).toContain('2월은 28일까지');
    expect(rows[2]!.message).toContain('시작');
    expect(rows[3]!.message).toContain("유형 '반차'");
    expect(rows[4]!.message).toContain('날짜로 알아볼 수 없습니다');
    expect(rows[5]!.message).toContain('모두 주말');
  });

  it('marks updates, unchanged rows and duplicates (last line wins)', () => {
    const existing = [makeHoliday('2026-12-25', '성탄절', 'public'), makeHoliday('2026-04-15', '창립일', 'company')];
    const rows = parseHolidayBulk([
      '2026-12-25\t성탄절\t공휴일',
      '2026-04-15\t창립기념일\t회사',
      '2026-08-01\t여름 휴무',
      '2026-08-01\t하계 휴가',
    ].join('\n'), existing, opt);
    expect(rows.map((r) => r.status)).toEqual(['same', 'update', 'replaced', 'add']);
    expect(rows[3]!.holidays[0]!.name).toBe('하계 휴가');
  });

  it('uses the kind name when the name is missing', () => {
    const [r] = parseHolidayBulk('2026-09-01', [], opt);
    expect(r!.holidays[0]).toMatchObject({ name: '회사 휴무', kind: 'company' });
    expect(r!.message).toContain('이름이 없어');
  });
});

describe('single dates win over ranges', () => {
  it('keeps 성탄절 inside a 연말 휴무 range, whichever comes first', () => {
    for (const lines of [
      ['2026-12-25\t성탄절\t공휴일', '2026-12-24~2026-12-31\t연말 휴무\t회사'],
      ['2026-12-24~2026-12-31\t연말 휴무\t회사', '2026-12-25\t성탄절\t공휴일'],
    ]) {
      const rows = parseHolidayBulk(lines.join('\n'), [], opt);
      const all = rows.flatMap((r) => r.holidays);
      expect(all.find((h) => h.date === '2026-12-25')).toMatchObject({ name: '성탄절', kind: 'public' });
      expect(all.filter((h) => h.date === '2026-12-25')).toHaveLength(1);
      expect(all).toHaveLength(6);
    }
  });
});
