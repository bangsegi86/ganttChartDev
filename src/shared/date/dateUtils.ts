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

// ---------------------------------------------------------------------------
// Fast path: day-number arithmetic.
//
// The scheduler calls these helpers hundreds of thousands of times per
// recalculation. Parsing/formatting through date-fns on every call dominated
// recalc time, so well-formed `YYYY-MM-DD` strings are converted to an integer
// day number (days since 1970-01-01, UTC — no DST or timezone drift) with
// small caches. Anything else falls back to the original date-fns path so
// behaviour for unusual input is unchanged.
// ---------------------------------------------------------------------------

const ISO_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;
const CACHE_LIMIT = 50_000;
const dayNumCache = new Map<string, number>();
const isoCache = new Map<number, string>();

/** Days since 1970-01-01 for a well-formed ISO day, or null. */
export function toDayNumber(iso: ISODate): number | null {
  const hit = dayNumCache.get(iso);
  if (hit !== undefined) return hit;
  const m = ISO_DAY_RE.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  // Reject roll-overs such as 2026-02-30 so they take the legacy path.
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return null;
  }
  const n = Math.round(ms / MS_PER_DAY);
  if (dayNumCache.size >= CACHE_LIMIT) dayNumCache.clear();
  dayNumCache.set(iso, n);
  return n;
}

/** ISO day string for a day number produced by `toDayNumber`. */
export function fromDayNumber(n: number): ISODate {
  const hit = isoCache.get(n);
  if (hit !== undefined) return hit;
  const dt = new Date(n * MS_PER_DAY);
  const y = dt.getUTCFullYear();
  const mo = dt.getUTCMonth() + 1;
  const d = dt.getUTCDate();
  const iso = `${String(y).padStart(4, '0')}-${mo < 10 ? '0' : ''}${mo}-${d < 10 ? '0' : ''}${d}`;
  if (isoCache.size >= CACHE_LIMIT) isoCache.clear();
  isoCache.set(n, iso);
  return iso;
}

/** Add (or subtract) whole calendar days to an ISO date. */
export function addDaysISO(iso: ISODate, days: number): ISODate {
  const n = toDayNumber(iso);
  if (n !== null && Number.isInteger(days)) return fromDayNumber(n + days);
  return toISO(addDays(toDate(iso), days));
}

/** Inclusive calendar-day count between two ISO dates (end - start). */
export function diffDaysISO(startISO: ISODate, endISO: ISODate): number {
  const a = toDayNumber(startISO);
  const b = toDayNumber(endISO);
  if (a !== null && b !== null) return b - a;
  return differenceInCalendarDays(toDate(endISO), toDate(startISO));
}

/** JS weekday index (0=Sun … 6=Sat) for an ISO date. */
export function weekdayOf(iso: ISODate): number {
  const n = toDayNumber(iso);
  // 1970-01-01 was a Thursday (4).
  if (n !== null) return (((n + 4) % 7) + 7) % 7;
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
