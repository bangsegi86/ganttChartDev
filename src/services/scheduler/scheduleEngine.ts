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
    // predecessors for downstream propagation.
    if (!task.manuallyScheduled) {
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
    if (!pred) continue;
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
  const depth = (t: Task): number => {
    let d = 0;
    let cur: Task | undefined = t;
    const byId = new Map(tasks.map((x) => [x.id, x]));
    while (cur?.parentId) {
      d++;
      cur = byId.get(cur.parentId);
    }
    return d;
  };
  const parents = tasks
    .filter((t) => childrenOf.has(t.id))
    .sort((a, b) => depth(b) - depth(a));

  for (const parent of parents) {
    const kids = childrenOf.get(parent.id) ?? [];
    if (kids.length === 0) continue;
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
