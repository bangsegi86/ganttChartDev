import type { Dependency, Task, TaskId } from '@/entities';

/**
 * Dependency-graph utilities shared by the scheduler and CPM engine.
 *
 * Only *leaf* tasks participate in the dependency network — summary (parent)
 * rows are roll-ups of their children and are never linked directly.
 */

export interface Adjacency {
  /** successors[id] = links where id is the predecessor. */
  successors: Map<TaskId, Dependency[]>;
  /** predecessors[id] = links where id is the successor. */
  predecessors: Map<TaskId, Dependency[]>;
}

export function buildAdjacency(deps: Dependency[]): Adjacency {
  const successors = new Map<TaskId, Dependency[]>();
  const predecessors = new Map<TaskId, Dependency[]>();
  for (const d of deps) {
    if (!successors.has(d.fromId)) successors.set(d.fromId, []);
    successors.get(d.fromId)!.push(d);
    if (!predecessors.has(d.toId)) predecessors.set(d.toId, []);
    predecessors.get(d.toId)!.push(d);
  }
  return { successors, predecessors };
}

/**
 * Kahn topological sort over the leaf-task dependency graph. Returns the
 * ordered task ids plus any ids that could not be ordered because they lie on
 * a cycle (`cyclic`).
 */
export function topologicalOrder(
  taskIds: TaskId[],
  deps: Dependency[],
): { order: TaskId[]; cyclic: TaskId[] } {
  const inDegree = new Map<TaskId, number>();
  const out = new Map<TaskId, TaskId[]>();
  for (const id of taskIds) {
    inDegree.set(id, 0);
    out.set(id, []);
  }
  for (const d of deps) {
    if (!inDegree.has(d.fromId) || !inDegree.has(d.toId)) continue;
    out.get(d.fromId)!.push(d.toId);
    inDegree.set(d.toId, (inDegree.get(d.toId) ?? 0) + 1);
  }

  const queue: TaskId[] = [];
  for (const [id, deg] of inDegree) if (deg === 0) queue.push(id);

  const order: TaskId[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of out.get(id) ?? []) {
      const deg = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }

  const cyclic = taskIds.filter((id) => !order.includes(id));
  return { order, cyclic };
}

/**
 * Detect whether adding a `from -> to` link would create a cycle, by checking
 * if `from` is already reachable from `to`.
 */
export function wouldCreateCycle(
  deps: Dependency[],
  fromId: TaskId,
  toId: TaskId,
): boolean {
  if (fromId === toId) return true;
  const adj = buildAdjacency(deps);
  const stack: TaskId[] = [toId];
  const seen = new Set<TaskId>();
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === fromId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const link of adj.successors.get(cur) ?? []) stack.push(link.toId);
  }
  return false;
}

/** Return only the leaf tasks (tasks with no children). */
export function leafTasks(tasks: Task[]): Task[] {
  const parentIds = new Set<TaskId>();
  for (const t of tasks) if (t.parentId) parentIds.add(t.parentId);
  return tasks.filter((t) => !parentIds.has(t.id));
}
