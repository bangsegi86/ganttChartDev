import { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '@/app/store/useProjectStore';
import type { Task } from '@/entities';
import { cn } from '@/shared/ui/cn';

type EditableField = 'name' | 'start' | 'end' | 'progress';

interface GridCellProps {
  task: Task;
  field: EditableField;
  className?: string;
}

/**
 * Inline-editable grid cell. Double-click (or the global editing signal) turns
 * the cell into an input; Enter/blur commits through the store (which records
 * an undo step), Escape cancels.
 */
export function GridCell({ task, field, className }: GridCellProps) {
  const updateTask = useProjectStore((s) => s.updateTask);
  const editingTaskId = useProjectStore((s) => s.editingTaskId);
  const setEditing = useProjectStore((s) => s.setEditing);

  const [editing, setEditing_] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // The gantt/grid can request editing of a task's name via the store.
  useEffect(() => {
    if (field === 'name' && editingTaskId === task.id && !editing) {
      begin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTaskId]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function begin(): void {
    // Progress edits use the raw number, not the "%"-formatted display string.
    setDraft(field === 'progress' ? String(task.progress) : displayValue(task, field));
    setEditing_(true);
  }

  function commit(): void {
    setEditing_(false);
    if (field === 'name') updateTask(task.id, { name: draft.trim() || task.name });
    else if (field === 'progress') {
      const n = Math.max(0, Math.min(100, Number(draft) || 0));
      updateTask(task.id, { progress: n });
    } else if (field === 'start' || field === 'end') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(draft)) {
        updateTask(task.id, { [field]: draft });
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
        type={field === 'progress' ? 'number' : field === 'name' ? 'text' : 'date'}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') cancel();
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
