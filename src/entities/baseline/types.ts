import type { TaskId } from '../task/types';

/**
 * A baseline is a frozen snapshot of the plan used to measure schedule
 * variance (계획 vs 실제). Only the fields needed for variance are stored.
 */
export interface BaselineEntry {
  taskId: TaskId;
  start: string;
  end: string;
  durationDays: number;
}

export interface Baseline {
  id: string;
  name: string;
  /** ISO timestamp the baseline was captured. */
  capturedAt: string;
  entries: BaselineEntry[];
}
