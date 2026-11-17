import { ChevronDown, Download, FileSpreadsheet, FileText, Globe, Image } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useProjectStore } from '@/app/store/useProjectStore';
import { tipProps } from '@/shared/ui/Tooltip';
import { type ZoomLevel } from '@/features/gantt/zoom';

export const ZOOM_LABELS: Record<ZoomLevel, string> = {
  hour: '시간',
  day: '일',
  week: '주',
  month: '월',
  quarter: '분기',
  year: '연',
};

/** Run an export with the current project and view settings. */
export async function runExport(kind: 'excel' | 'png' | 'pdf' | 'html'): Promise<void> {
  const state = useProjectStore.getState();
  const { project, schedules } = state.derived;
  const name = project.name || 'gantt';
  const baseInput = {
    project,
    schedules,
    zoom: state.view.zoom,
    theme: state.view.theme,
    showCritical: state.view.showCriticalPath,
    showBaseline: state.view.showBaseline,
  };
  // Export modules (and ExcelJS/jsPDF) are loaded on demand to keep startup light.
  if (kind === 'excel') {
    const { exportExcel } = await import('@/services/export/exportExcel');
    await exportExcel(project, name, baseInput);
  } else if (kind === 'html') {
    const { exportHtml } = await import('@/services/export/exportHtml');
    await exportHtml(baseInput, name);
  } else {
    const { exportPng, exportPdf, warnIfTruncated } = await import('@/services/export/exportImage');
    warnIfTruncated(await (kind === 'png' ? exportPng : exportPdf)(baseInput, name));
  }
}

// ---------------------------------------------------------------------------
// Assignee filter dropdown
// ---------------------------------------------------------------------------

export function AssigneeFilterButton() {
  const resources = useProjectStore((s) => s.derived.project.resources);
  const filterMode = useProjectStore((s) => s.view.filterMode);
  const filterAssigneeIds = useProjectStore((s) => s.view.filterAssigneeIds);
  const setViewFilter = useProjectStore((s) => s.setViewFilter);
  const clearViewFilter = useProjectStore((s) => s.clearViewFilter);

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const isActive = filterMode === 'assignee' && filterAssigneeIds.length > 0;
  const activeSet = new Set(isActive ? filterAssigneeIds : []);

  const toggle = (id: string) => {
    const next = new Set(activeSet);
    if (next.has(id)) next.delete(id); else next.add(id);
    if (next.size === 0) clearViewFilter();
    else setViewFilter('assignee', null, [...next]);
  };

  const openDropdown = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const panel = document.getElementById('assignee-filter-panel');
      if (panel?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const tid = setTimeout(() => window.addEventListener('mousedown', close), 50);
    return () => { clearTimeout(tid); window.removeEventListener('mousedown', close); };
  }, [open]);

  if (resources.length === 0) return null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={open ? () => setOpen(false) : openDropdown}
        className={`inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 text-xs font-medium transition-all select-none ${
          isActive
            ? 'border-accent/40 bg-accent/15 text-accent'
            : 'border-border bg-surface-2 text-content hover:bg-surface-3'
        }`}
        {...tipProps('담당자별로 보기', '고른 담당자가 맡은 작업만 보여 줍니다. 여러 명을 고를 수 있습니다.')}
      >
        <span>담당자별{isActive ? ` (${activeSet.size}명)` : ''}</span>
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && createPortal(
        <div
          id="assignee-filter-panel"
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
          className="min-w-[180px] rounded-md border border-border bg-surface shadow-xl text-xs"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="border-b border-border px-3 py-2 font-semibold text-content-muted text-2xs uppercase tracking-wider">
            담당자 필터
          </div>
          <div className="max-h-64 overflow-auto py-1">
            {resources.map((r) => (
              <label
                key={r.id}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  checked={activeSet.has(r.id)}
                  onChange={() => toggle(r.id)}
                  className="h-3.5 w-3.5 accent-[rgb(var(--color-accent))]"
                />
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color ?? '#888' }} />
                <span className="flex-1 text-content">{r.name}</span>
                {r.role && <span className="text-2xs text-content-muted">{r.role}</span>}
              </label>
            ))}
          </div>
          {isActive && (
            <div className="border-t border-border px-3 py-1.5">
              <button
                onClick={() => { clearViewFilter(); setOpen(false); }}
                className="text-2xs text-content-muted hover:text-content"
              >
                필터 초기화
              </button>
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Export dropdown
// ---------------------------------------------------------------------------

interface ExportDropdownProps {
  onExport: (kind: 'excel' | 'png' | 'pdf' | 'html') => Promise<void>;
  onShare: () => void;
}

export function ExportDropdown({ onExport, onShare }: ExportDropdownProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos]   = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const openMenu = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.right });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const tid = setTimeout(() => window.addEventListener('mousedown', close), 50);
    return () => { clearTimeout(tid); window.removeEventListener('mousedown', close); };
  }, [open]);

  const run = async (fn: () => Promise<void>) => {
    setOpen(false);
    await fn();
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={open ? () => setOpen(false) : openMenu}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface-2 px-2 text-xs font-medium text-content transition-all hover:bg-surface-3 select-none"
        {...tipProps('내보내기', '엑셀, 웹 페이지(HTML), 이미지(PNG), PDF로 내보내거나 프로젝트 사본을 저장합니다.')}
      >
        <Download size={14} />
        <span>내보내기</span>
        <ChevronDown size={11} className={`transition-transform text-content-muted ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && createPortal(
        <div
          style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-100%)', zIndex: 9999 }}
          className="min-w-[260px] rounded-md border border-border bg-surface shadow-xl text-xs py-1"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-wider text-content-muted border-b border-border mb-1">
            내보내기
          </div>
          {([
            { kind: 'excel' as const, icon: <FileSpreadsheet size={13} />, label: '엑셀 (.xlsx)', hint: '작업 표와 간트 그림이 담긴 엑셀 파일' },
            { kind: 'html'  as const, icon: <Globe size={13} />,          label: '웹 페이지 (.html)', hint: '앱 없이 브라우저로 열어 보는 차트 (전체 작업 포함)' },
            { kind: 'png'   as const, icon: <Image size={13} />,          label: '이미지 (.png)', hint: '전체 차트 그림. 아주 큰 프로젝트는 일부가 잘릴 수 있음' },
            { kind: 'pdf'   as const, icon: <FileText size={13} />,       label: 'PDF 문서', hint: 'A4 가로, 필요하면 여러 쪽으로 나눔' },
          ]).map(({ kind, icon, label, hint }) => (
            <button
              key={kind}
              onClick={() => void run(() => onExport(kind))}
              className="flex w-full items-start gap-2.5 px-3 py-1.5 text-left hover:bg-surface-2 text-content"
            >
              <span className="mt-0.5 text-content-muted">{icon}</span>
              <span className="flex flex-col">
                <span>{label}</span>
                <span className="text-2xs text-content-muted">{hint}</span>
              </span>
            </button>
          ))}
          <div className="my-1 border-t border-border" />
          <button
            onClick={() => { setOpen(false); onShare(); }}
            className="flex w-full items-start gap-2.5 px-3 py-1.5 text-left hover:bg-surface-2 text-content"
          >
            <span className="mt-0.5 text-content-muted"><Download size={13} /></span>
            <span className="flex flex-col">
              <span>사본 저장 (.smgantt)</span>
              <span className="text-2xs text-content-muted">다른 사람에게 줄 프로젝트 파일. 지금 파일은 그대로 둠</span>
            </span>
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

export function firstSelectedId(): string | undefined {
  const ids = useProjectStore.getState().selectedTaskIds;
  return ids.size ? [...ids][ids.size - 1] : undefined;
}

/** Apply a per-task action to every selected task. */
export function useSelectedAction(action: 'indentTask' | 'outdentTask' | 'moveTaskUp' | 'moveTaskDown'): () => void {
  const fn = useProjectStore((s) => s[action]);
  return () => {
    const ids = useProjectStore.getState().selectedTaskIds;
    for (const id of ids) fn(id);
  };
}
