import type { Holiday, WorkCalendar } from '@/entities';
import {
  addDaysISO,
  diffDaysISO,
  fromDayNumber,
  toDayNumber,
  weekdayOf,
  type ISODate,
} from '@/shared/date/dateUtils';

/**
 * Working-time math. The `WorkingCalendar` wraps a `WorkCalendar` config plus a
 * holiday lookup and answers the questions the scheduler needs:
 *  - is a given day a working day?
 *  - what is the date N working days after a start?
 *  - how many working days lie between two dates?
 *
 * In `calendar` mode every day counts; in `working` mode weekends and
 * (optionally) holidays are skipped.
 */
export class WorkingCalendar {
  private readonly working: Set<number>;
  private readonly holidaySet: Set<string>;
  private readonly config: WorkCalendar;

  constructor(config: WorkCalendar, holidays: Holiday[]) {
    this.config = config;
    this.working = new Set(config.workingWeekdays);
    this.holidaySet = new Set(
      config.excludeHolidays ? holidays.map((h) => h.date) : [],
    );
  }

  /** Working-day test on a day number (see `toDayNumber`). */
  private isWorkingNum(n: number): boolean {
    if (this.config.mode === 'calendar') return true;
    if (!this.working.has((((n + 4) % 7) + 7) % 7)) return false;
    if (this.holidaySet.size > 0 && this.holidaySet.has(fromDayNumber(n))) return false;
    return true;
  }

  /** True if `iso` is a working day under the current calendar. */
  isWorkingDay(iso: ISODate): boolean {
    if (this.config.mode === 'calendar') return true;
    if (!this.working.has(weekdayOf(iso))) return false;
    if (this.holidaySet.has(iso)) return false;
    return true;
  }

  /** Roll `iso` forward to the next working day (returns `iso` if already one). */
  nextWorkingDay(iso: ISODate): ISODate {
    let cursor = iso;
    let guard = 0;
    while (!this.isWorkingDay(cursor) && guard < 3650) {
      cursor = addDaysISO(cursor, 1);
      guard++;
    }
    return cursor;
  }

  /** Roll `iso` backward to the previous working day. */
  previousWorkingDay(iso: ISODate): ISODate {
    let cursor = iso;
    let guard = 0;
    while (!this.isWorkingDay(cursor) && guard < 3650) {
      cursor = addDaysISO(cursor, -1);
      guard++;
    }
    return cursor;
  }

  /**
   * Given an inclusive start date and a duration in working days, return the
   * inclusive finish date. A 1-day task starts and finishes on the same day.
   */
  finishDateFor(startISO: ISODate, durationDays: number): ISODate {
    const duration = Math.max(1, Math.round(durationDays));
    if (this.config.mode === 'calendar') {
      return addDaysISO(startISO, duration - 1);
    }
    const first = this.nextWorkingDay(startISO);
    const n0 = toDayNumber(first);
    if (n0 !== null && this.working.size > 0) {
      let n = n0;
      let counted = 1; // the start day itself is the first working day
      while (counted < duration) {
        n++;
        if (this.isWorkingNum(n)) counted++;
      }
      return fromDayNumber(n);
    }
    let cursor = first;
    let counted = 1;
    while (counted < duration) {
      cursor = addDaysISO(cursor, 1);
      if (this.isWorkingDay(cursor)) counted++;
    }
    return cursor;
  }

  /**
   * Add `n` working days to a date and return the resulting working day. Used
   * for dependency lag/lead. `n` may be negative.
   */
  addWorkingDays(iso: ISODate, n: number): ISODate {
    if (this.config.mode === 'calendar') return addDaysISO(iso, n);
    if (n === 0) return this.nextWorkingDay(iso);
    const step = n > 0 ? 1 : -1;
    let remaining = Math.abs(n);
    const start = toDayNumber(iso);
    if (start !== null && this.working.size > 0) {
      let cur = start;
      while (remaining > 0) {
        cur += step;
        if (this.isWorkingNum(cur)) remaining--;
      }
      return fromDayNumber(cur);
    }
    let cursor = iso;
    while (remaining > 0) {
      cursor = addDaysISO(cursor, step);
      if (this.isWorkingDay(cursor)) remaining--;
    }
    return cursor;
  }

  /**
   * Count working days in the inclusive range [startISO, endISO]. Returns 0 if
   * end precedes start.
   */
  workingDaysBetween(startISO: ISODate, endISO: ISODate): number {
    if (endISO < startISO) return 0;
    if (this.config.mode === 'calendar') {
      return diffDaysISO(startISO, endISO) + 1;
    }
    const a = toDayNumber(startISO);
    const b = toDayNumber(endISO);
    if (a !== null && b !== null) {
      let count = 0;
      for (let n = a; n <= b; n++) if (this.isWorkingNum(n)) count++;
      return count;
    }
    let count = 0;
    let cursor = startISO;
    while (cursor <= endISO) {
      if (this.isWorkingDay(cursor)) count++;
      cursor = addDaysISO(cursor, 1);
    }
    return count;
  }
}
