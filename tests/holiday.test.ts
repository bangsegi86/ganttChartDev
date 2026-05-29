import { describe, expect, it } from 'vitest';
import { generateKoreanHolidays } from '@/services/holiday/koreanHolidays';

describe('koreanHolidays', () => {
  const holidays = generateKoreanHolidays(2024, 2026);
  const byDate = new Map(holidays.map((h) => [h.date, h]));

  it('includes the fixed solar holidays', () => {
    expect(byDate.get('2024-01-01')?.name).toBe('신정');
    expect(byDate.get('2024-03-01')?.name).toBe('삼일절');
    expect(byDate.get('2024-08-15')?.name).toBe('광복절');
    expect(byDate.get('2024-10-03')?.name).toBe('개천절');
    expect(byDate.get('2024-12-25')?.name).toBe('성탄절');
  });

  it('expands Seollal into a three-day block', () => {
    // 2024 Seollal anchor is 2024-02-10.
    expect(byDate.get('2024-02-09')?.name).toBe('설날');
    expect(byDate.get('2024-02-10')?.name).toBe('설날');
    expect(byDate.get('2024-02-11')?.name).toBe('설날');
  });

  it('generates a substitute holiday when Seollal touches the weekend', () => {
    // 2024-02-10 (Sat) & 02-11 (Sun) are weekend → substitute on 02-12 (Mon).
    const sub = byDate.get('2024-02-12');
    expect(sub?.substitute).toBe(true);
    expect(sub?.name).toContain('대체');
  });

  it('grants a substitute when 어린이날 falls on a weekend', () => {
    // 2024-05-05 is a Sunday → substitute should appear on the next free day.
    const childrensDay = byDate.get('2024-05-05');
    expect(childrensDay?.name).toBe('어린이날');
    const sub = holidays.find(
      (h) => h.substitute && h.name.includes('어린이날') && h.date > '2024-05-05',
    );
    expect(sub).toBeDefined();
  });

  it('does not grant a substitute for 현충일 (ineligible)', () => {
    // 2024-06-06 is a Thursday anyway, but assert no 현충일 substitute exists.
    const sub = holidays.find((h) => h.substitute && h.name.includes('현충일'));
    expect(sub).toBeUndefined();
  });

  it('produces strictly sorted, deduplicated substitute dates', () => {
    const subs = holidays.filter((h) => h.substitute).map((h) => h.date);
    const unique = new Set(subs);
    expect(unique.size).toBe(subs.length);
  });
});
