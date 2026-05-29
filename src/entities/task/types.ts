/**
 * Domain model for a schedulable task / WBS row.
 *
 * Dates are stored as ISO-8601 calendar-day strings (`YYYY-MM-DD`) rather than
 * `Date` objects so the model is serialisable, timezone-stable, and cheap to
 * diff for undo/redo. The scheduling engine converts to/from day numbers.
 */
export type TaskId = string;

export type Priority = 'low' | 'medium' | 'high' | 'critical';

/** Whether a task's schedule is driven by the engine or pinned by the user. */
export type ConstraintType =
  | 'asap' // As Soon As Possible (default, dependency-driven)
  | 'snet' // Start No Earlier Than
  | 'mso' // Must Start On
  | 'mfo'; // Must Finish On

export interface Task {
  id: TaskId;
  /** Parent task id for WBS hierarchy; `null` for top-level rows. */
  parentId: TaskId | null;
  name: string;
  /** Inclusive start day, `YYYY-MM-DD`. */
  start: string;
  /** Inclusive finish day, `YYYY-MM-DD`. */
  end: string;
  /** Planned duration in working days. Derived but cached for fast rendering. */
  durationDays: number;
  /** 0–100. */
  progress: number;
  priority: Priority;
  /** Resource ids assigned to this task. */
  assigneeIds: string[];
  notes: string;
  /** True when the task is a milestone (zero-duration marker). */
  isMilestone: boolean;
  /** Collapsed state for parent rows in the grid/gantt. */
  collapsed: boolean;
  constraint: ConstraintType;
  /** Constraint anchor date when `constraint !== 'asap'`. */
  constraintDate: string | null;
  /** Manual scheduling pins the bar; the engine will not move it. */
  manuallyScheduled: boolean;
  /** Display order within siblings. */
  order: number;
  /** Hex bar colour override; falls back to priority colour when null. */
  color: string | null;
}

/** Computed scheduling metadata produced by the critical-path engine. */
export interface TaskSchedule {
  id: TaskId;
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  totalFloat: number;
  freeFloat: number;
  isCritical: boolean;
}
