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

function getVisibleRows() {
  const { derived, view } = useProjectStore.getState();
  const tasks = filterTasksForView(
    derived.project.tasks,
    derived.project.viewGroups,
    { mode: view.filterMode, groupId: view.filterGroupId, focusIds: view.focusIds },
  );
  return buildVisibleRows(tasks);
}

/**
 * Global copy/paste via keydown + navigator.clipboard so Ctrl+C / Ctrl+V
 * work regardless of which element has focus. The native `paste` event only
 * fires on editable elements; using keydown avoids that restriction.
 */
export function useCopyPaste(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (isTextTarget(e.target)) return;

      const key = e.key.toLowerCase();

      if (key === 'c') {
        const { selectedTaskIds } = useProjectStore.getState();
        if (selectedTaskIds.size === 0) return;
        e.preventDefault();
        const rows = getVisibleRows();
        const selectedRows = rows.filter((r) => selectedTaskIds.has(r.task.id));
        if (selectedRows.length === 0) return;
        const header = ['작업명', '시작', '종료', '기간(일)', '진척(%)', '우선순위'].join('\t');
        const lines = selectedRows.map((r) => {
          const t = r.task;
          return [t.name, t.start, t.end, t.durationDays, t.progress, PRIORITY_KO[t.priority] ?? t.priority].join('\t');
        });
        void navigator.clipboard.writeText([header, ...lines].join('\n'));
        return;
      }

      if (key === 'v') {
        e.preventDefault();
        void navigator.clipboard.readText().then((text) => {
          if (!text.trim()) return;
          const state = useProjectStore.getState();
          const rows = getVisibleRows();
          const selectedIds = rows
            .filter((r) => state.selectedTaskIds.has(r.task.id))
            .map((r) => r.task.id);
          if (selectedIds.length > 0) {
            state.updateTasksFromTsv(selectedIds, text);
          } else {
            state.importTsvTasks(text);
          }
        });
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
