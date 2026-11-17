import type { Project } from '@/entities';

/**
 * Structural sharing between consecutive project versions.
 *
 * Every edit clones the document and re-solves the schedule, which produces
 * brand-new objects for every task even when only one changed. Re-using the
 * previous object wherever the content is identical gives two wins:
 *  - undo snapshots share all unchanged tasks, so 100 history steps cost
 *    roughly one copy of the project plus the edited parts, not 100 copies;
 *  - React `memo` / selector equality works again, so only the rows whose
 *    task actually changed re-render.
 *
 * Project data is plain JSON (strings, numbers, booleans, null, arrays,
 * objects), so a structural deep-equality check is sufficient.
 */
export function shareProject(prev: Project, next: Project): Project {
  const out: Record<string, unknown> = {};
  let allSame = true;
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    const a = (prev as unknown as Record<string, unknown>)[key];
    const b = (next as unknown as Record<string, unknown>)[key];
    const shared = key === 'tasks' ? shareById(a, b) : share(a, b);
    out[key] = shared;
    if (shared !== a) allSame = false;
  }
  return allSame ? prev : (out as unknown as Project);
}

/** Re-use `prev` (or its unchanged parts) when structurally equal to `next`. */
export function share<T>(prev: T, next: T): T {
  if (prev === next) return prev;
  if (Array.isArray(prev) && Array.isArray(next)) {
    let same = prev.length === next.length;
    const arr = next.map((v, i) => {
      const s = i < prev.length ? share(prev[i], v) : v;
      if (s !== prev[i]) same = false;
      return s;
    });
    return (same ? prev : arr) as unknown as T;
  }
  if (isObject(prev) && isObject(next)) {
    return (deepEqual(prev, next) ? prev : next) as T;
  }
  return next;
}

/** Array of `{ id }` records: match by id so inserts/reorders still share. */
function shareById(prev: unknown, next: unknown): unknown {
  if (!Array.isArray(prev) || !Array.isArray(next)) return share(prev, next);
  const byId = new Map<unknown, unknown>();
  for (const item of prev) if (isObject(item)) byId.set(item.id, item);
  let same = prev.length === next.length;
  const arr = next.map((item, i) => {
    const old = isObject(item) ? byId.get(item.id) : undefined;
    const s = old !== undefined && deepEqual(old, item) ? old : item;
    if (s !== prev[i]) same = false;
    return s;
  });
  return same ? prev : arr;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    for (const k of ka) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}
