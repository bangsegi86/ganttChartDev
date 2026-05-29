import type { TaskId } from '../task/types';

/**
 * Dependency (link) between two tasks. Supports the four classic PDM link
 * types. `lagDays` may be negative (a lead).
 */
export type DependencyId = string;

export type DependencyType =
  | 'FS' // Finish-to-Start  (successor starts after predecessor finishes)
  | 'SS' // Start-to-Start
  | 'FF' // Finish-to-Finish
  | 'SF'; // Start-to-Finish

export interface Dependency {
  id: DependencyId;
  /** Predecessor task. */
  fromId: TaskId;
  /** Successor task. */
  toId: TaskId;
  type: DependencyType;
  /** Lag in working days; negative = lead. */
  lagDays: number;
}
