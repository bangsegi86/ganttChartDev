/**
 * Working-time calendar. Drives how the scheduler advances dates.
 *
 * `workingWeekdays` uses JS `Date.getDay()` indices (0 = Sunday … 6 = Saturday).
 */
export interface WorkCalendar {
  /** Weekday indices considered working days. Default Mon–Fri = [1,2,3,4,5]. */
  workingWeekdays: number[];
  /** When true, holidays are skipped during scheduling. */
  excludeHolidays: boolean;
  /**
   * Scheduling mode:
   *  - `working`: durations count only working days (skips weekends/holidays).
   *  - `calendar`: durations count every calendar day.
   */
  mode: 'working' | 'calendar';
  /** Hours in a standard working day, used for resource workload. */
  hoursPerDay: number;
}

export const DEFAULT_CALENDAR: WorkCalendar = {
  workingWeekdays: [1, 2, 3, 4, 5],
  excludeHolidays: true,
  mode: 'working',
  hoursPerDay: 8,
};
