import { nanoid } from 'nanoid';
import type { Dependency, Project, Task } from '@/entities';
import { PROJECT_SCHEMA_VERSION } from '@/entities';
import { todayISO } from '@/shared/date/dateUtils';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const CONSTRAINTS = new Set(['asap', 'snet', 'mso', 'mfo']);
const DEP_TYPES = new Set(['FS', 'SS', 'FF', 'SF']);

const isDay = (v: unknown): v is string => typeof v === 'string' && ISO_DAY.test(v);
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/**
 * Make a loaded document safe to render: fill missing fields with defaults,
 * repair invalid values and drop references to tasks that do not exist.
 * Files written by older versions, edited by hand or partially corrupted
 * otherwise crash the grid/gantt the moment a field is read.
 */
export function normalizeProject(raw: unknown): Project {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<Project>;
  const startDate = isDay(p.startDate) ? p.startDate : todayISO();

  const seen = new Set<string>();
  const tasks: Task[] = arr<Partial<Task>>(p.tasks)
    .filter((t) => t && typeof t === 'object')
    .map((t, i) => {
      let id = typeof t.id === 'string' && t.id ? t.id : nanoid(10);
      if (seen.has(id)) id = nanoid(10);
      seen.add(id);
      const start = isDay(t.start) ? t.start : startDate;
      const end = isDay(t.end) && t.end >= start ? t.end : start;
      return {
        ...t,
        id,
        parentId: typeof t.parentId === 'string' ? t.parentId : null,
        name: typeof t.name === 'string' ? t.name : '',
        start,
        end,
        durationDays: Math.max(0, num(t.durationDays, 1)),
        progress: Math.min(100, Math.max(0, num(t.progress, 0))),
        priority: PRIORITIES.has(t.priority as string) ? t.priority! : 'medium',
        assigneeIds: arr<unknown>(t.assigneeIds).filter((a): a is string => typeof a === 'string'),
        notes: typeof t.notes === 'string' ? t.notes : '',
        isMilestone: t.isMilestone === true,
        collapsed: t.collapsed === true,
        constraint: CONSTRAINTS.has(t.constraint as string) ? t.constraint! : 'asap',
        constraintDate: isDay(t.constraintDate) ? t.constraintDate : null,
        manuallyScheduled: t.manuallyScheduled === true,
        order: num(t.order, i),
        color: typeof t.color === 'string' ? t.color : null,
        cancelled: t.cancelled === true,
      } as Task;
    });

  const ids = new Set(tasks.map((t) => t.id));
  // Orphans (parent missing) and self-parented rows move to the root.
  for (const t of tasks) {
    if (t.parentId && (!ids.has(t.parentId) || t.parentId === t.id)) t.parentId = null;
  }
  // Break parent cycles (a → b → a) by detaching the row that closes the loop.
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const t of tasks) {
    const path = new Set<string>([t.id]);
    let cur = t.parentId ? byId.get(t.parentId) : undefined;
    while (cur) {
      if (path.has(cur.id)) { t.parentId = null; break; }
      path.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }

  const dependencies: Dependency[] = arr<Partial<Dependency>>(p.dependencies)
    .filter((d) => d && ids.has(d.fromId as string) && ids.has(d.toId as string) && d.fromId !== d.toId)
    .map((d) => ({
      ...d,
      id: typeof d.id === 'string' && d.id ? d.id : nanoid(8),
      fromId: d.fromId!,
      toId: d.toId!,
      type: DEP_TYPES.has(d.type as string) ? d.type! : 'FS',
      lagDays: Math.round(num(d.lagDays, 0)),
    }));

  const cal = (p.calendar ?? {}) as Partial<Project['calendar']>;
  const weekdays = arr<unknown>(cal.workingWeekdays).filter(
    (d): d is number => typeof d === 'number' && d >= 0 && d <= 6,
  );

  return {
    ...p,
    schemaVersion: Math.max(num(p.schemaVersion, PROJECT_SCHEMA_VERSION), PROJECT_SCHEMA_VERSION),
    id: typeof p.id === 'string' && p.id ? p.id : nanoid(8),
    name: typeof p.name === 'string' && p.name.trim() ? p.name : '새 프로젝트',
    startDate,
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString(),
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : new Date().toISOString(),
    calendar: {
      ...cal,
      // Never allow an empty working week: the scheduler would find no working day.
      workingWeekdays: weekdays.length > 0 ? weekdays : [1, 2, 3, 4, 5],
      excludeHolidays: cal.excludeHolidays !== false,
      mode: cal.mode === 'calendar' ? 'calendar' : 'working',
      hoursPerDay: Math.max(1, num(cal.hoursPerDay, 8)),
    },
    tasks,
    dependencies,
    resources: arr(p.resources),
    holidays: arr<{ date?: unknown }>(p.holidays).filter((h) => h && isDay(h.date)) as Project['holidays'],
    baselines: arr(p.baselines),
    activeBaselineId: typeof p.activeBaselineId === 'string' ? p.activeBaselineId : null,
    viewGroups: arr(p.viewGroups),
    markers: arr(p.markers),
  };
}
