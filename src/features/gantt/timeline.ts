import {
  addDaysISO,
  diffDaysISO,
  maxISO,
  minISO,
  toDate,
  toISO,
  type ISODate,
} from '@/shared/date/dateUtils';
import type { Task } from '@/entities';

/**
 * Maps calendar dates to horizontal pixel positions. The timeline spans the
 * project's date range with padding on both ends, scaled by `dayWidth`.
 */
export class Timeline {
  readonly start: ISODate;
  readonly end: ISODate;
  readonly dayWidth: number;
  readonly totalDays: number;
  readonly width: number;

  constructor(start: ISODate, end: ISODate, dayWidth: number) {
    this.start = start;
    this.end = end;
    this.dayWidth = dayWidth;
    this.totalDays = diffDaysISO(start, end) + 1;
    this.width = this.totalDays * dayWidth;
  }

  /** Pixel x for the *start* of the given date column. */
  xFor(iso: ISODate): number {
    return diffDaysISO(this.start, iso) * this.dayWidth;
  }

  /** Inverse: the date at a given pixel x (floored to a day). */
  dateAt(x: number): ISODate {
    const days = Math.floor(x / this.dayWidth);
    return addDaysISO(this.start, days);
  }

  /** Number of whole days represented by a pixel delta. */
  daysForPixels(px: number): number {
    return Math.round(px / this.dayWidth);
  }

  /** Iterate day columns in the visible x-range [x0, x1]. */
  *daysBetweenPixels(x0: number, x1: number): Generator<{ iso: ISODate; x: number }> {
    const firstDay = Math.max(0, Math.floor(x0 / this.dayWidth));
    const lastDay = Math.min(this.totalDays - 1, Math.ceil(x1 / this.dayWidth));
    for (let d = firstDay; d <= lastDay; d++) {
      yield { iso: addDaysISO(this.start, d), x: d * this.dayWidth };
    }
  }
}

/**
 * Derive a padded timeline covering all task dates. Falls back to a sensible
 * window around the project start when there are no tasks.
 */
export function buildTimeline(
  tasks: Task[],
  startDate: ISODate,
  dayWidth: number,
  padDays = 14,
): Timeline {
  const starts = tasks.map((t) => t.start);
  const ends = tasks.map((t) => t.end);
  const min = minISO(starts) ?? startDate;
  const max = maxISO(ends) ?? addDaysISO(startDate, 30);
  // Snap the start back to the first day of its week for tidy headers.
  const snappedStart = toISO(startOfWeek(toDate(addDaysISO(min, -padDays))));
  const paddedEnd = addDaysISO(max, padDays);
  return new Timeline(snappedStart, paddedEnd, dayWidth);
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}
