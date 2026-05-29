import {
  addDays,
  differenceInCalendarDays,
  format,
  parseISO,
  startOfDay,
} from 'date-fns';

/**
 * Date helpers operating on `YYYY-MM-DD` ISO day strings. We deliberately avoid
 * passing `Date` objects around the model to dodge timezone drift: a calendar
 * day is a label, not an instant.
 */

export type ISODate = string;

/** Parse an ISO day string into a local-midnight Date. */
export function toDate(iso: ISODate): Date {
  return startOfDay(parseISO(iso));
}

/** Format a Date as an ISO day string. */
export function toISO(date: Date): ISODate {
  return format(date, 'yyyy-MM-dd');
}

/** Today's date as an ISO day string. */
export function todayISO(): ISODate {
  return toISO(new Date());
}

/** Add (or subtract) whole calendar days to an ISO date. */
export function addDaysISO(iso: ISODate, days: number): ISODate {
  return toISO(addDays(toDate(iso), days));
}

/** Inclusive calendar-day count between two ISO dates (end - start). */
export function diffDaysISO(startISO: ISODate, endISO: ISODate): number {
  return differenceInCalendarDays(toDate(endISO), toDate(startISO));
}

/** JS weekday index (0=Sun … 6=Sat) for an ISO date. */
export function weekdayOf(iso: ISODate): number {
  return toDate(iso).getDay();
}

/** Clamp an ISO date into the inclusive [min, max] range. */
export function clampISO(iso: ISODate, min: ISODate, max: ISODate): ISODate {
  if (iso < min) return min;
  if (iso > max) return max;
  return iso;
}

/** Minimum of a list of ISO dates (lexicographic order == chronological). */
export function minISO(dates: ISODate[]): ISODate | null {
  if (dates.length === 0) return null;
  return dates.reduce((a, b) => (a < b ? a : b));
}

/** Maximum of a list of ISO dates. */
export function maxISO(dates: ISODate[]): ISODate | null {
  if (dates.length === 0) return null;
  return dates.reduce((a, b) => (a > b ? a : b));
}
