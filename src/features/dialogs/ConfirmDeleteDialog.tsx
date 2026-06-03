import { useEffect, useRef } from 'react';
import { useProjectStore } from '@/app/store/useProjectStore';
import { Button } from '@/shared/ui/Button';
import { Trash2 } from 'lucide-react';

/**
 * Modal confirmation that appears when the user tries to permanently delete
 * tasks that are already in the "cancelled" state. Shown via `confirmDeletePending`
 * store flag; hard-deletes on Yes, dismisses on No.
 */
export function ConfirmDeleteDialog() {
  const confirmDeletePending = useProjectStore((s) => s.confirmDeletePending);
  const hardDeleteSelected = useProjectStore((s) => s.hardDeleteSelected);
  const cancelConfirmDelete = useProjectStore((s) => s.cancelConfirmDelete);
  const count = useProjectStore((s) => {
    const ids = s.selectedTaskIds;
    return s.derived.project.tasks.filter((t) => ids.has(t.id)).length;
  });

  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!confirmDeletePending) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelConfirmDelete();
      if (e.key === 'Enter') hardDeleteSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmDeletePending, cancelConfirmDelete, hardDeleteSelected]);

  if (!confirmDeletePending) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="presentation"
      onMouseDown={cancelConfirmDelete}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="일정 영구 삭제"
        className="animate-dialog-in w-[336px] rounded-lg border border-border bg-surface p-6 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <Trash2 size={16} className="shrink-0 text-critical" />
          <h2 className="text-sm font-semibold text-content">일정 영구 삭제</h2>
        </div>
        <p className="mb-1 text-xs text-content">
          취소된 일정 <span className="font-semibold text-critical">{count}개</span>를 영구적으로
          삭제합니다.
        </p>
        <p className="mb-5 text-xs text-content-muted">이 작업은 실행 취소(Undo)로 되돌릴 수 없습니다.</p>
        <div className="flex justify-end gap-2">
          <Button ref={cancelRef} size="sm" onClick={cancelConfirmDelete}>
            아니오
          </Button>
          <Button size="sm" variant="danger" onClick={hardDeleteSelected}>
            예, 삭제
          </Button>
        </div>
      </div>
    </div>
  );
}
