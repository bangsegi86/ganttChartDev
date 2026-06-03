import { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '@/app/store/useProjectStore';
import type { Task } from '@/entities';
import { cn } from '@/shared/ui/cn';

type EditableField = 'name' | 'start' | 'end' | 'progress';

interface EditRequest {
  taskId: string;
  colKey: string;
  initial: string | null;
}

interface GridCellProps {
  task: Task;
  field: EditableField;
  className?: string;
  /** When non-null and matching this cell, begin editing. `initial` seeds the
   *  draft: a single char (overwrite) or null (keep current value, F2 style). */
  editRequest?: EditRequest | null;
  /** Called once editing has begun, so the parent can clear the request. */
  onEditConsumed?: () => void;
  /** Called after committing with Enter, so the parent can move down a row. */
  onEditNavigate?: () => void;
}

/**
 * Inline-editable grid cell. Editing can be triggered by double-click, the
 * global editing signal (name), or an Excel-style edit request from the grid
 * (type-to-edit / F2). Enter/blur commits through the store (recording an undo
 * step), Escape cancels; Enter additionally asks the grid to move down a row.
 */
export function GridCell({
  task,
  field,
  className,
  editRequest,
  onEditConsumed,
  onEditNavigate,
}: GridCellProps) {
  const updateTask = useProjectStore((s) => s.updateTask);
  const editingTaskId = useProjectStore((s) => s.editingTaskId);
  const setEditing = useProjectStore((s) => s.setEditing);

  const [editing, setEditing_] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  /** Whether to select-all (F2/double-click) vs put cursor at end (type-to-edit). */
  const selectAllRef = useRef(true);

  // The gantt/grid can request editing of a task's name via the store.
  useEffect(() => {
    if (field === 'name' && editingTaskId === task.id && !editing) {
      begin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTaskId]);

  // Excel-style edit request from the grid (type-to-edit or F2).
  useEffect(() => {
    if (editRequest && editRequest.taskId === task.id && editRequest.colKey === field && !editing) {
      begin(editRequest.initial);
      onEditConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRequest]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      if (selectAllRef.current) {
        inputRef.current?.select();
      } else {
        const el = inputRef.current;
        if (el) {
          const len = el.value.length;
          el.setSelectionRange(len, len);
        }
      }
    }
  }, [editing]);

  function begin(initial?: string | null): void {
    if (initial != null && initial !== '') {
      // Type-to-edit: overwrite with the typed character, cursor at end.
      setDraft(initial);
      selectAllRef.current = false;
    } else {
      // F2 / double-click: keep current value, select all.
      setDraft(field === 'progress' ? String(task.progress) : displayValue(task, field));
      selectAllRef.current = true;
    }
    setEditing_(true);
  }

  function commit(): void {
    setEditing_(false);
    if (field === 'name') {
      updateTask(task.id, { name: draft.trim() || task.name });
    } else if (field === 'progress') {
      const n = Math.max(0, Math.min(100, Number(draft) || 0));
      updateTask(task.id, { progress: n });
    } else if (field === 'start' || field === 'end') {
      const raw = draft.trim().replace(/\//g, '-');
      // Accept both YYYY-MM-DD and YYYYMMDD
      const normalized = /^\d{8}$/.test(raw)
        ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
        : raw;
      if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        updateTask(task.id, { [field]: normalized });
      }
    }
    if (field === 'name') setEditing(null);
  }

  function cancel(): void {
    setEditing_(false);
    if (field === 'name') setEditing(null);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        type={field === 'progress' ? 'number' : 'text'}
        placeholder={field === 'start' || field === 'end' ? 'YYYY-MM-DD' : undefined}
        inputMode={field === 'start' || field === 'end' ? 'numeric' : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            onEditNavigate?.();
          } else if (e.key === 'Escape') {
            cancel();
          }
          e.stopPropagation();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className="h-6 w-full rounded border border-accent bg-surface px-1 text-xs text-content outline-none"
      />
    );
  }

  return (
    <span
      className={cn('w-full cursor-text truncate', className)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        begin();
      }}
      title={displayValue(task, field)}
    >
      {displayValue(task, field)}
    </span>
  );
}

function displayValue(task: Task, field: EditableField): string {
  switch (field) {
    case 'name':
      return task.name;
    case 'start':
      return task.start;
    case 'end':
      return task.end;
    case 'progress':
      return `${task.progress}%`;
  }
}
