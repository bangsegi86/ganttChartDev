import type { Project, TaskId, TaskSchedule } from '@/entities';
import { scheduleProject } from '@/services/scheduler/scheduleEngine';
import { computeCriticalPath } from '@/services/critical-path/cpm';
import { maxISO } from '@/shared/date/dateUtils';

/** Derived, read-only analysis recomputed whenever the project changes. */
export interface DerivedSchedule {
  project: Project;
  schedules: Map<TaskId, TaskSchedule>;
  criticalPath: TaskId[];
  projectDuration: number;
  /** Latest finish date across all tasks. */
  projectFinish: string | null;
  cyclicTaskIds: TaskId[];
}

/**
 * Single source of truth for re-solving a project: runs the forward scheduler,
 * then CPM, and returns the scheduled project plus all derived metrics. Kept
 * separate from the store so it is easy to unit test and reuse.
 */
export function recalc(input: Project): DerivedSchedule {
  // Normalise optional fields that may be absent on older saved documents.
  const normalized: Project = {
    ...input,
    viewGroups: input.viewGroups ?? [],
    tasks: input.tasks.map((t) => ({ ...t, cancelled: t.cancelled ?? false })),
  };
  const { tasks, cyclicTaskIds } = scheduleProject(normalized);
  const project: Project = { ...normalized, tasks };
  const cpm = computeCriticalPath(tasks, project.dependencies);
  const projectFinish = maxISO(tasks.map((t) => t.end));
  return {
    project,
    schedules: cpm.schedules,
    criticalPath: cpm.criticalPath,
    projectDuration: cpm.projectDuration,
    projectFinish,
    cyclicTaskIds,
  };
}
