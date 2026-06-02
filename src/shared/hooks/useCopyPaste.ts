import { useEffect } from 'react';
import { useProjectStore } from '@/app/store/useProjectStore';
import { buildVisibleRows } from '@/features/grid/treeModel';
import { filterTasksForView } from '@/features/view/viewFilter';

const PRIORITY_KO: Record<string, string> = {
  low: '낮음', medium: '보통', high: '높음', critical: '긴급',
};

function isTextTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

/**
 * Document-level copy/paste handler so Ctrl+C / Ctrl+V work regardless of
 * which panel has focus (DataGrid, Gantt, etc.).
 *
 * Copy  — writes selected tasks as TSV to the system clipboard.
 * Paste — reads TSV from the system clipboard (Excel or app-to-app) and
 *         either updates selected rows in-place or creates new tasks.
 */
export function useCopyPaste(): void {
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      if (isTextTarget(e.target)) return;
      const state = useProjectStore.getState();
      const { selectedTaskIds, derived, view } = state;
      if (selectedTaskIds.size === 0) return;

      const visibleTasks = filterTasksForView(
        derived.project.tasks,
        derived.project.viewGroups,
        { mode: view.filterMode, groupId: view.filterGroupId, focusIds: view.focusIds },
      );
      const rows = buildVisibleRows(visibleTasks);
      const selectedRows = rows.filter((r) => selectedTaskIds.has(r.task.id));
      if (selectedRows.length === 0) return;

      e.preventDefault();
      const header = ['작업명', '시작', '종료', '기간(일)', '진척(%)', '우선순위'].join('\t');
      const lines = selectedRows.map((r) => {
        const t = r.task;
        return [t.name, t.start, t.end, t.durationDays, t.progress, PRIORITY_KO[t.priority] ?? t.priority].join('\t');
      });
      e.clipboardData?.setData('text/plain', [header, ...lines].join('\n'));
    };

    const onPaste = (e: ClipboardEvent) => {
      if (isTextTarget(e.target)) return;
      const text = e.clipboardData?.getData('text');
      if (!text?.trim()) return;
      e.preventDefault();

      const state = useProjectStore.getState();
      const { selectedTaskIds, derived, view } = state;
      const visibleTasks = filterTasksForView(
        derived.project.tasks,
        derived.project.viewGroups,
        { mode: view.filterMode, groupId: view.filterGroupId, focusIds: view.focusIds },
      );
      const rows = buildVisibleRows(visibleTasks);
      const selectedIds = rows
        .filter((r) => selectedTaskIds.has(r.task.id))
        .map((r) => r.task.id);

      if (selectedIds.length > 0) {
        state.updateTasksFromTsv(selectedIds, text);
      } else {
        state.importTsvTasks(text);
      }
    };

    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
    };
  }, []);
}
