import type { TaskId } from '../task/types';

/**
 * A user-defined "view group" (보기 그룹): a named, coloured collection of tasks
 * gathered for focused viewing. Groups are a *display* concept layered over the
 * WBS — a task can belong to any number of groups without changing its place in
 * the hierarchy. Persisted with the project so membership survives reload/undo.
 */
export type ViewGroupId = string;

export interface ViewGroup {
  id: ViewGroupId;
  name: string;
  /** Hex chip colour. */
  color: string;
  /** Member task ids, in the order they were added. */
  taskIds: TaskId[];
}
