import type { Holiday } from '@/entities';
import { addDaysISO, weekdayOf } from '@/shared/date/dateUtils';

/**
 * Korean public-holiday generator.
 *
 * Solar (fixed-date) holidays are computed algorithmically. Lunar holidays
 * (설날 / 추석 / 부처님오신날) cannot be derived without a lunar-calendar
 * conversion, so their Gregorian anchor dates are tabulated for 2023–2030 —
 * the practical planning window. Substitute holidays (대체공휴일) are then
 * derived per the current Korean rule set.
 */

/** Anchor (central) Gregorian dates for lunar holidays, by year. */
interface LunarAnchors {
  /** Lunar New Year's Day (설날 당일). Block = day-1, day, day+1. */
  seollal: string;
  /** Chuseok day (추석 당일, 음력 8/15). Block = day-1, day, day+1. */
  chuseok: string;
  /** Buddha's Birthday (부처님오신날, 음력 4/8). */
  buddha: string;
}

const LUNAR_TABLE: Record<number, LunarAnchors> = {
  2023: { seollal: '2023-01-22', chuseok: '2023-09-29', buddha: '2023-05-27' },
  2024: { seollal: '2024-02-10', chuseok: '2024-09-17', buddha: '2024-05-15' },
  2025: { seollal: '2025-01-29', chuseok: '2025-10-06', buddha: '2025-05-05' },
  2026: { seollal: '2026-02-17', chuseok: '2026-09-25', buddha: '2026-05-24' },
  2027: { seollal: '2027-02-07', chuseok: '2027-09-15', buddha: '2027-05-13' },
  2028: { seollal: '2028-01-27', chuseok: '2028-10-03', buddha: '2028-05-02' },
  2029: { seollal: '2029-02-13', chuseok: '2029-09-22', buddha: '2029-05-20' },
  2030: { seollal: '2030-02-03', chuseok: '2030-09-12', buddha: '2030-05-09' },
};

/** Holidays that are eligible for a substitute when they hit a weekend/overlap. */
const SUBSTITUTE_ELIGIBLE = new Set([
  '삼일절',
  '어린이날',
  '부처님오신날',
  '광복절',
  '설날',
  '추석',
  '개천절',
  '한글날',
  '성탄절',
]);

function fixedSolarHolidays(year: number): { date: string; name: string }[] {
  const y = String(year);
  return [
    { date: `${y}-01-01`, name: '신정' },
    { date: `${y}-03-01`, name: '삼일절' },
    { date: `${y}-05-05`, name: '어린이날' },
    { date: `${y}-06-06`, name: '현충일' },
    { date: `${y}-08-15`, name: '광복절' },
    { date: `${y}-10-03`, name: '개천절' },
    { date: `${y}-10-09`, name: '한글날' },
    { date: `${y}-12-25`, name: '성탄절' },
  ];
}

function lunarHolidays(year: number): { date: string; name: string }[] {
  const anchors = LUNAR_TABLE[year];
  if (!anchors) return [];
  return [
    { date: addDaysISO(anchors.seollal, -1), name: '설날' },
    { date: anchors.seollal, name: '설날' },
    { date: addDaysISO(anchors.seollal, 1), name: '설날' },
    { date: addDaysISO(anchors.chuseok, -1), name: '추석' },
    { date: anchors.chuseok, name: '추석' },
    { date: addDaysISO(anchors.chuseok, 1), name: '추석' },
    { date: anchors.buddha, name: '부처님오신날' },
  ];
}

/**
 * Generate the full Korean holiday list (incl. substitutes) for an inclusive
 * year range.
 */
export function generateKoreanHolidays(startYear: number, endYear: number): Holiday[] {
  const base: { date: string; name: string }[] = [];
  for (let y = startYear; y <= endYear; y++) {
    base.push(...fixedSolarHolidays(y), ...lunarHolidays(y));
  }
  base.sort((a, b) => a.date.localeCompare(b.date));

  // Set of all official (non-substitute) holiday dates for overlap detection.
  const officialDates = new Set(base.map((h) => h.date));
  const occupied = new Set(officialDates); // grows as substitutes are added

  const result: Holiday[] = base.map((h) => ({
    date: h.date,
    name: h.name,
    substitute: false,
    userDefined: false,
  }));

  // Substitute rule: an eligible holiday that falls on Saturday(6)/Sunday(0)
  // or overlaps another official holiday rolls forward to the next day that is
  // neither a weekend nor already occupied by a holiday/substitute.
  for (const h of base) {
    if (!SUBSTITUTE_ELIGIBLE.has(h.name)) continue;
    const wd = weekdayOf(h.date);
    const onWeekend = wd === 0 || wd === 6;
    const overlaps = countOccurrences(base, h.date) > 1;
    if (!onWeekend && !overlaps) continue;

    let candidate = addDaysISO(h.date, 1);
    // Guard against runaway loops.
    for (let i = 0; i < 14; i++) {
      const cwd = weekdayOf(candidate);
      const free = cwd !== 0 && cwd !== 6 && !occupied.has(candidate);
      if (free) break;
      candidate = addDaysISO(candidate, 1);
    }
    if (!occupied.has(candidate)) {
      occupied.add(candidate);
      result.push({
        date: candidate,
        name: `${h.name} 대체공휴일`,
        substitute: true,
        userDefined: false,
      });
    }
  }

  result.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}

function countOccurrences(list: { date: string }[], date: string): number {
  let n = 0;
  for (const item of list) if (item.date === date) n++;
  return n;
}
