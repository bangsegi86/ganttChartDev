import type { Dependency, Task, TaskId, TaskSchedule } from '@/entities';
import { buildAdjacency, leafTasks, topologicalOrder } from '../dependency/graph';

/**
 * Critical Path Method (CPM) over the leaf-task network.
 *
 * Time is measured in abstract "duration units" (working days) so the analysis
 * is calendar-independent. We run a forward pass (early start/finish), a
 * backward pass (late start/finish), then derive total/free float. Tasks with
 * zero total float form the critical path.
 */
export interface CriticalPathResult {
  schedules: Map<TaskId, TaskSchedule>;
  /** Critical task ids in topological order. */
  criticalPath: TaskId[];
  /** Project duration in working days (max early finish). */
  projectDuration: number;
}

export function computeCriticalPath(
  tasks: Task[],
  deps: Dependency[],
): CriticalPathResult {
  const leaves = leafTasks(tasks);
  const ids = leaves.map((t) => t.id);
  const dur = new Map<TaskId, number>(
    leaves.map((t) => [t.id, t.isMilestone ? 0 : Math.max(1, t.durationDays)]),
  );
  const adj = buildAdjacency(deps);
  const { order } = topologicalOrder(ids, deps);

  const ES = new Map<TaskId, number>();
  const EF = new Map<TaskId, number>();

  // Forward pass: earliest dates.
  for (const id of order) {
    const d = dur.get(id) ?? 0;
    const preds = adj.predecessors.get(id) ?? [];
    let es = 0;
    for (const link of preds) {
      const pES = ES.get(link.fromId) ?? 0;
      const pEF = EF.get(link.fromId) ?? 0;
      let candidate: number;
      switch (link.type) {
        case 'FS':
          candidate = pEF + link.lagDays;
          break;
        case 'SS':
          candidate = pES + link.lagDays;
          break;
        case 'FF':
          candidate = pEF + link.lagDays - d;
          break;
        case 'SF':
          candidate = pES + link.lagDays - d;
          break;
      }
      es = Math.max(es, candidate);
    }
    ES.set(id, es);
    EF.set(id, es + d);
  }

  const projectDuration = Math.max(0, ...ids.map((id) => EF.get(id) ?? 0));

  // Backward pass: latest dates. Terminal tasks may finish by project end.
  const LF = new Map<TaskId, number>();
  const LS = new Map<TaskId, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]!;
    const d = dur.get(id) ?? 0;
    const succs = adj.successors.get(id) ?? [];
    let lf: number;
    if (succs.length === 0) {
      lf = projectDuration;
    } else {
      lf = Number.POSITIVE_INFINITY;
      for (const link of succs) {
        const sLS = LS.get(link.toId) ?? projectDuration;
        const sLF = LF.get(link.toId) ?? projectDuration;
        let candidate: number;
        switch (link.type) {
          case 'FS':
            candidate = sLS - link.lagDays;
            break;
          case 'SS':
            candidate = sLS - link.lagDays + d;
            break;
          case 'FF':
            candidate = sLF - link.lagDays;
            break;
          case 'SF':
            candidate = sLF - link.lagDays + d;
            break;
        }
        lf = Math.min(lf, candidate);
      }
    }
    LF.set(id, lf);
    LS.set(id, lf - d);
  }

  // Float + criticality.
  const schedules = new Map<TaskId, TaskSchedule>();
  for (const id of ids) {
    const es = ES.get(id) ?? 0;
    const ef = EF.get(id) ?? 0;
    const ls = LS.get(id) ?? 0;
    const lf = LF.get(id) ?? 0;
    const totalFloat = ls - es;

    // Free float: slack before any successor's early start is pushed.
    const succs = adj.successors.get(id) ?? [];
    let freeFloat = totalFloat;
    if (succs.length > 0) {
      freeFloat = Number.POSITIVE_INFINITY;
      for (const link of succs) {
        const sES = ES.get(link.toId) ?? 0;
        const d = dur.get(id) ?? 0;
        let slack: number;
        switch (link.type) {
          case 'FS':
            slack = sES - (ef + link.lagDays);
            break;
          case 'SS':
            slack = sES - (es + link.lagDays);
            break;
          case 'FF':
            slack = sES - (ef + link.lagDays - (dur.get(link.toId) ?? 0));
            break;
          case 'SF':
            slack = sES - (es + link.lagDays - (dur.get(link.toId) ?? 0)) - d + d;
            break;
        }
        freeFloat = Math.min(freeFloat, slack);
      }
      freeFloat = Math.max(0, freeFloat);
    }

    schedules.set(id, {
      id,
      earlyStart: es,
      earlyFinish: ef,
      lateStart: ls,
      lateFinish: lf,
      totalFloat,
      freeFloat,
      // A task is critical only when it has zero float AND participates in at
      // least one dependency link. Isolated tasks always have float = 0 when
      // they share the same max duration, but labelling them critical with no
      // connections is misleading and confusing for users.
      isCritical:
        totalFloat <= 0 &&
        ((adj.predecessors.get(id)?.length ?? 0) > 0 ||
          (adj.successors.get(id)?.length ?? 0) > 0),
    });
  }

  const criticalPath = order.filter((id) => schedules.get(id)?.isCritical);

  return { schedules, criticalPath, projectDuration };
}
