import type { Task, TaskId } from '@/entities';

/** A task augmented with hierarchy metadata for flat rendering. */
export interface VisibleRow {
  task: Task;
  depth: number;
  hasChildren: boolean;
  /** 1-based WBS outline number, e.g. "2.3.1". */
  wbs: string;
  /** Global row index among visible rows. */
  index: number;
}

/**
 * Flatten the task hierarchy into an ordered list of *visible* rows, honouring
 * sibling `order` and collapse state. Collapsed parents hide their entire
 * subtree. Computed once per render and shared by the grid and gantt so both
 * panes stay perfectly row-aligned.
 *
 * Pass `{ includeCollapsed: true }` to flatten the *entire* tree regardless of
 * collapse state — used by exports, where every task must appear.
 */
export function buildVisibleRows(
  tasks: Task[],
  options?: { includeCollapsed?: boolean },
): VisibleRow[] {
  const includeCollapsed = options?.includeCollapsed ?? false;
  const childrenOf = new Map<TaskId | null, Task[]>();
  for (const t of tasks) {
    const key = t.parentId;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(t);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.order - b.order);

  const rows: VisibleRow[] = [];

  const walk = (parentId: TaskId | null, depth: number, prefix: string): void => {
    const kids = childrenOf.get(parentId) ?? [];
    kids.forEach((task, i) => {
      const wbs = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      const hasChildren = (childrenOf.get(task.id)?.length ?? 0) > 0;
      rows.push({ task, depth, hasChildren, wbs, index: rows.length });
      if (hasChildren && (includeCollapsed || !task.collapsed)) walk(task.id, depth + 1, wbs);
    });
  };

  walk(null, 0, '');
  return rows;
}

/** Map of taskId → visible row index (for fast lookups during rendering). */
export function rowIndexMap(rows: VisibleRow[]): Map<TaskId, number> {
  const map = new Map<TaskId, number>();
  rows.forEach((r) => map.set(r.task.id, r.index));
  return map;
}
