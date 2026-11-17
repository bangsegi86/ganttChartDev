import type { Dependency, Project, Task, TaskId } from '@/entities';
import { WorkingCalendar } from './workCalendar';
import { buildAdjacency, leafTasks, topologicalOrder } from '../dependency/graph';
import { addDaysISO, maxISO, minISO, type ISODate } from '@/shared/date/dateUtils';

/**
 * Forward scheduling engine.
 *
 * Given the dependency network and a working calendar it computes start/finish
 * dates for every leaf task (respecting constraints and manual pins), then
 * rolls those up into summary (parent) rows.
 *
 * The engine is *pure*: it returns a new task list and never mutates inputs,
 * which keeps it trivial to use inside undo/redo snapshots.
 */
export interface ScheduleResult {
  tasks: Task[];
  /** Ids of tasks that participate in a dependency cycle (left unscheduled). */
  cyclicTaskIds: TaskId[];
}

export function scheduleProject(project: Project): ScheduleResult {
  const cal = new WorkingCalendar(project.calendar, project.holidays);
  const leaves = leafTasks(project.tasks);
  const leafById = new Map<TaskId, Task>(leaves.map((t) => [t.id, { ...t }]));
  const adj = buildAdjacency(project.dependencies);
  const { order, cyclic } = topologicalOrder(
    leaves.map((t) => t.id),
    project.dependencies,
  );

  for (const id of order) {
    const task = leafById.get(id);
    if (!task) continue;

    // Manually scheduled tasks keep their authored dates but still act as
    // predecessors for downstream propagation. Cancelled tasks are frozen
    // where they are and are ignored as predecessors (see below).
    if (!task.manuallyScheduled && !task.cancelled) {
      const earliest = earliestStartFromPredecessors(task, adj, leafById, cal, project);
      const constrained = applyConstraint(task, earliest, cal);
      task.start = cal.nextWorkingDay(constrained);
      task.end = task.isMilestone
        ? task.start
        : cal.finishDateFor(task.start, task.durationDays);
    }
    // Keep duration cache in sync with the (possibly user-edited) dates.
    if (!task.isMilestone) {
      task.durationDays = cal.workingDaysBetween(task.start, task.end);
    } else {
      task.end = task.start;
      task.durationDays = 0;
    }
  }

  // Re-assemble full task list: leaves first (scheduled), then roll up parents.
  const scheduled = project.tasks.map((t) => leafById.get(t.id) ?? { ...t });
  rollUpParents(scheduled, cal);

  return { tasks: scheduled, cyclicTaskIds: cyclic };
}

/** Compute the earliest legal start date implied by a task's predecessors. */
function earliestStartFromPredecessors(
  task: Task,
  adj: ReturnType<typeof buildAdjacency>,
  leafById: Map<TaskId, Task>,
  cal: WorkingCalendar,
  project: Project,
): ISODate {
  const links: Dependency[] = adj.predecessors.get(task.id) ?? [];
  if (links.length === 0) {
    // No predecessors: anchor to the project start.
    return project.startDate;
  }

  const candidates: ISODate[] = [];
  for (const link of links) {
    const pred = leafById.get(link.fromId);
    // A cancelled predecessor no longer constrains its successors.
    if (!pred || pred.cancelled) continue;
    const dur = Math.max(1, task.durationDays);
    switch (link.type) {
      case 'FS': {
        // Successor starts the working day after predecessor finishes (+lag).
        const afterFinish = cal.addWorkingDays(pred.end, 1);
        candidates.push(cal.addWorkingDays(afterFinish, link.lagDays));
        break;
      }
      case 'SS': {
        candidates.push(cal.addWorkingDays(pred.start, link.lagDays));
        break;
      }
      case 'FF': {
        // Finish aligns with predecessor finish (+lag); back-solve the start.
        const finish = cal.addWorkingDays(pred.end, link.lagDays);
        candidates.push(cal.addWorkingDays(finish, -(dur - 1)));
        break;
      }
      case 'SF': {
        const finish = cal.addWorkingDays(pred.start, link.lagDays);
        candidates.push(cal.addWorkingDays(finish, -(dur - 1)));
        break;
      }
    }
  }
  // Every predecessor cancelled: behave like a task without predecessors.
  return maxISO(candidates) ?? project.startDate;
}

/** Apply a date constraint on top of the dependency-derived earliest start. */
function applyConstraint(task: Task, earliest: ISODate, cal: WorkingCalendar): ISODate {
  switch (task.constraint) {
    case 'snet':
      // Start No Earlier Than: cannot precede the anchor.
      return task.constraintDate && task.constraintDate > earliest
        ? task.constraintDate
        : earliest;
    case 'mso':
      // Must Start On: pinned regardless of predecessors.
      return task.constraintDate ?? earliest;
    case 'mfo': {
      // Must Finish On: derive start from the pinned finish.
      if (!task.constraintDate) return earliest;
      const dur = Math.max(1, task.durationDays);
      return cal.addWorkingDays(task.constraintDate, -(dur - 1));
    }
    case 'asap':
    default:
      return earliest;
  }
}

/**
 * Roll summary tasks up from their children: span = [min child start, max child
 * end]; progress = duration-weighted average of children.
 */
function rollUpParents(tasks: Task[], cal: WorkingCalendar): void {
  const childrenOf = new Map<TaskId, Task[]>();
  for (const t of tasks) {
    if (t.parentId) {
      if (!childrenOf.has(t.parentId)) childrenOf.set(t.parentId, []);
      childrenOf.get(t.parentId)!.push(t);
    }
  }

  // Process parents deepest-first so nested summaries aggregate correctly.
  // Depths are memoised in one O(n) pass (previously the id map was rebuilt
  // inside every comparator call, making this O(n² log n)).
  const byId = new Map(tasks.map((x) => [x.id, x]));
  const depthCache = new Map<TaskId, number>();
  const depth = (t: Task): number => {
    const cached = depthCache.get(t.id);
    if (cached !== undefined) return cached;
    // Walk up until a cached ancestor (or the root), guarding against cycles.
    const chain: Task[] = [];
    const seen = new Set<TaskId>();
    let cur: Task | undefined = t;
    let base = 0;
    while (cur && !seen.has(cur.id)) {
      const c = depthCache.get(cur.id);
      if (c !== undefined) { base = c; break; }
      seen.add(cur.id);
      chain.push(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      if (!cur) base = -1;
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      base += 1;
      depthCache.set(chain[i]!.id, base);
    }
    return depthCache.get(t.id) ?? 0;
  };
  const parents = tasks
    .filter((t) => childrenOf.has(t.id))
    .map((t) => ({ t, d: depth(t) }))
    .sort((a, b) => b.d - a.d)
    .map((x) => x.t);

  for (const parent of parents) {
    const allKids = childrenOf.get(parent.id) ?? [];
    if (allKids.length === 0) continue;
    // Cancelled children do not count toward the summary span or progress,
    // unless every child is cancelled (then the summary still spans them).
    const active = allKids.filter((k) => !k.cancelled);
    const kids = active.length > 0 ? active : allKids;
    const start = minISO(kids.map((k) => k.start));
    const end = maxISO(kids.map((k) => k.end));
    if (start) parent.start = start;
    if (end) parent.end = end;
    parent.durationDays = cal.workingDaysBetween(parent.start, parent.end);

    const totalDur = kids.reduce((s, k) => s + Math.max(1, k.durationDays), 0);
    const weighted = kids.reduce(
      (s, k) => s + k.progress * Math.max(1, k.durationDays),
      0,
    );
    parent.progress = totalDur > 0 ? Math.round(weighted / totalDur) : 0;
  }
}

/** Convenience: shift a task (and its bar) by a number of calendar days. */
export function shiftTaskDates(task: Task, deltaDays: number): Task {
  return {
    ...task,
    start: addDaysISO(task.start, deltaDays),
    end: addDaysISO(task.end, deltaDays),
  };
}
