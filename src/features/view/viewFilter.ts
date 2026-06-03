import { useMemo } from 'react';
import type { Task, TaskId, ViewGroup } from '@/entities';
import { useProjectStore } from '@/app/store/useProjectStore';

/** Which subset of tasks the grid/gantt/calendar should display. */
export type FilterMode = 'all' | 'group' | 'focus' | 'assignee';

export interface ViewFilter {
  mode: FilterMode;
  /** Active view group when `mode === 'group'`. */
  groupId: string | null;
  /** Snapshot of task ids to show when `mode === 'focus'`. */
  focusIds: TaskId[];
  /** Resource ids to filter by when `mode === 'assignee'`. */
  assigneeIds: string[];
}

/**
 * Resolve the displayed task list for a filter. When a filter is active the
 * result is *flattened* (parent links dropped, order re-packed) so exactly the
 * chosen tasks appear as a clean top-level list — no surrounding hierarchy.
 * When the filter is `all`, the original hierarchical tasks are returned
 * untouched.
 */
export function filterTasksForView(
  tasks: Task[],
  groups: ViewGroup[],
  filter: ViewFilter,
): Task[] {
  let keep: Set<TaskId> | null = null;

  if (filter.mode === 'group' && filter.groupId) {
    const group = groups.find((g) => g.id === filter.groupId);
    if (group) keep = new Set(group.taskIds);
  } else if (filter.mode === 'focus') {
    keep = new Set(filter.focusIds);
  } else if (filter.mode === 'assignee' && filter.assigneeIds.length > 0) {
    const ids = new Set(filter.assigneeIds);
    keep = new Set(
      tasks.filter((t) => t.assigneeIds.some((aid) => ids.has(aid))).map((t) => t.id),
    );
  }

  if (!keep) return tasks;

  const subset = tasks.filter((t) => keep!.has(t.id));
  // Flatten: render as a flat list in the task array's existing order.
  return subset.map((t, i) => ({ ...t, parentId: null, order: i, collapsed: false }));
}

/** True when any non-`all` filter is currently applied. */
export function useFilterActive(): boolean {
  return useProjectStore((s) => s.view.filterMode !== 'all');
}

/**
 * Memoised hook returning the tasks that should be displayed given the current
 * view filter. Shared by the grid, gantt and calendar so all panes stay in sync.
 */
export function useVisibleTasks(): Task[] {
  const tasks = useProjectStore((s) => s.derived.project.tasks);
  const groups = useProjectStore((s) => s.derived.project.viewGroups);
  const mode = useProjectStore((s) => s.view.filterMode);
  const groupId = useProjectStore((s) => s.view.filterGroupId);
  const focusIds = useProjectStore((s) => s.view.focusIds);
  const assigneeIds = useProjectStore((s) => s.view.filterAssigneeIds);
  return useMemo(
    () => filterTasksForView(tasks, groups, { mode, groupId, focusIds, assigneeIds }),
    [tasks, groups, mode, groupId, focusIds, assigneeIds],
  );
}
