import type { Project, ResourceId } from '@/entities';
import { WorkingCalendar } from '@/services/scheduler/workCalendar';
import { addDaysISO, type ISODate } from '@/shared/date/dateUtils';

export interface WeeklyLoad {
  weekStart: ISODate;
  hours: number;
  /** Days within the week whose load exceeds capacity. */
  overloadedDays: number;
}

export interface ResourceWorkload {
  resourceId: ResourceId;
  totalHours: number;
  overloadedDays: number;
  peakDailyHours: number;
  weeks: WeeklyLoad[];
}

/**
 * Compute per-resource daily/weekly workload across the project. Each leaf task
 * spreads `hoursPerDay` of effort across its working days, split evenly among
 * its assignees. A day exceeding the resource's capacity is flagged as an
 * over-allocation (과부하).
 */
export function computeWorkload(project: Project): ResourceWorkload[] {
  const cal = new WorkingCalendar(project.calendar, project.holidays);
  const hoursPerDay = project.calendar.hoursPerDay;

  // resourceId -> (dayISO -> hours)
  const daily = new Map<ResourceId, Map<ISODate, number>>();
  const ensure = (id: ResourceId): Map<ISODate, number> => {
    if (!daily.has(id)) daily.set(id, new Map());
    return daily.get(id)!;
  };

  for (const task of project.tasks) {
    if (task.isMilestone || task.assigneeIds.length === 0) continue;
    // Skip summary rows (their children carry the real assignments).
    if (project.tasks.some((t) => t.parentId === task.id)) continue;
    const share = hoursPerDay / task.assigneeIds.length;
    let cursor = task.start;
    let guard = 0;
    while (cursor <= task.end && guard < 4000) {
      if (cal.isWorkingDay(cursor)) {
        for (const rid of task.assigneeIds) {
          const map = ensure(rid);
          map.set(cursor, (map.get(cursor) ?? 0) + share);
        }
      }
      cursor = addDaysISO(cursor, 1);
      guard++;
    }
  }

  return project.resources.map((res) => {
    const map = daily.get(res.id) ?? new Map<ISODate, number>();
    const weekMap = new Map<ISODate, WeeklyLoad>();
    let totalHours = 0;
    let overloadedDays = 0;
    let peakDailyHours = 0;

    for (const [day, hours] of map) {
      totalHours += hours;
      peakDailyHours = Math.max(peakDailyHours, hours);
      const over = hours > res.capacityHoursPerDay + 1e-6;
      if (over) overloadedDays++;
      const wk = weekStartOf(day);
      const entry = weekMap.get(wk) ?? { weekStart: wk, hours: 0, overloadedDays: 0 };
      entry.hours += hours;
      if (over) entry.overloadedDays++;
      weekMap.set(wk, entry);
    }

    const weeks = [...weekMap.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    return { resourceId: res.id, totalHours, overloadedDays, peakDailyHours, weeks };
  });
}

function weekStartOf(iso: ISODate): ISODate {
  const d = new Date(iso);
  const day = d.getDay();
  return addDaysISO(iso, -day);
}
