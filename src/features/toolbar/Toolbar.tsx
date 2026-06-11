import {
  ArrowDown,
  ArrowUp,
  Ban,
  CalendarRange,
  ChevronDown,
  Copy,
  Download,
  FilePlus2,
  FolderInput,
  FileSpreadsheet,
  FileText,
  FlagTriangleRight,
  FolderOpen,
  Globe,
  Image,
  Indent,
  Layers,
  MapPin,
  Moon,
  Outdent,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  Route,
  Save,
  Settings2,
  Sun,
  Trash2,
  Undo2,
  Users,
  CalendarClock,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useProjectStore } from '@/app/store/useProjectStore';
import { Button } from '@/shared/ui/Button';
import { ZOOM_ORDER, type ZoomLevel } from '@/features/gantt/zoom';
import { exportExcel } from '@/services/export/exportExcel';
import { exportPdf, exportPng } from '@/services/export/exportImage';
import { exportHtml } from '@/services/export/exportHtml';

const ZOOM_LABELS: Record<ZoomLevel, string> = {
  hour: '시간',
  day: '일',
  week: '주',
  month: '월',
  quarter: '분기',
  year: '연',
};

interface ToolbarProps {
  onOpenHolidays: () => void;
  onOpenResources: () => void;
  onOpenCalendar: () => void;
  onOpenBaselines: () => void;
  onOpenViewGroups: () => void;
  onOpenMarkers: () => void;
}

/** Top command bar. Groups document, edit, view and export actions. */
export function Toolbar({
  onOpenHolidays,
  onOpenResources,
  onOpenCalendar,
  onOpenBaselines,
  onOpenViewGroups,
  onOpenMarkers,
}: ToolbarProps) {
  const view = useProjectStore((s) => s.view);
  const viewGroups = useProjectStore((s) => s.derived.project.viewGroups);
  const setViewFilter = useProjectStore((s) => s.setViewFilter);
  const selectedCountForFilter = useProjectStore((s) => s.selectedTaskIds.size);
  const past = useProjectStore((s) => s.past.length);
  const future = useProjectStore((s) => s.future.length);
  const selectedCount = useProjectStore((s) => s.selectedTaskIds.size);
  const dirty = useProjectStore((s) => s.dirty);

  const tasks = useProjectStore((s) => s.derived.project.tasks);
  const selectedTaskIds = useProjectStore((s) => s.selectedTaskIds);
  // Derive cancel state for adaptive button labels.
  const cancelState = (() => {
    if (selectedTaskIds.size === 0) return 'none' as const;
    const sel = tasks.filter((t) => selectedTaskIds.has(t.id));
    if (sel.length === 0) return 'none' as const;
    if (sel.every((t) => t.cancelled)) return 'all-cancelled' as const;
    return 'has-active' as const;
  })();

  const addTask = useProjectStore((s) => s.addTask);
  const deleteSelected = useProjectStore((s) => s.deleteSelected);
  const uncancelSelected = useProjectStore((s) => s.uncancelSelected);
  const duplicateSelected = useProjectStore((s) => s.duplicateSelected);
  const indentSelected = useSelectedAction('indentTask');
  const outdentSelected = useSelectedAction('outdentTask');
  const moveUpSelected = useSelectedAction('moveTaskUp');
  const moveDownSelected = useSelectedAction('moveTaskDown');
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const setZoom = useProjectStore((s) => s.setZoom);
  const zoomBy = useProjectStore((s) => s.zoomBy);
  const toggleCritical   = useProjectStore((s) => s.toggleCriticalPath);
  const toggleTodayLine  = useProjectStore((s) => s.toggleTodayLine);
  const toggleTheme = useProjectStore((s) => s.toggleTheme);
  const saveProject = useProjectStore((s) => s.saveProject);
  const saveAsProject = useProjectStore((s) => s.saveAsProject);
  const shareExport = useProjectStore((s) => s.shareExport);
  const shareImport = useProjectStore((s) => s.shareImport);
  const currentFilePath = useProjectStore((s) => s.currentFilePath);
  const setActiveView = useProjectStore((s) => s.setActiveView);
  const renameProject = useProjectStore((s) => s.renameProject);
  const projectName = useProjectStore((s) => s.derived.project.name);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  const beginRename = () => {
    setNameDraft(projectName);
    setEditingName(true);
    setTimeout(() => { nameRef.current?.select(); }, 20);
  };

  const commitRename = () => {
    setEditingName(false);
    if (nameDraft.trim()) renameProject(nameDraft.trim());
  };

  const exportNow = async (kind: 'excel' | 'png' | 'pdf' | 'html') => {
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
    if (kind === 'excel') await exportExcel(project, name, baseInput);
    else if (kind === 'html') await exportHtml(baseInput, name);
    else if (kind === 'png') await exportPng(baseInput, name);
    else await exportPdf(baseInput, name);
  };

  return (
    <div className="flex min-w-0 items-center gap-1 border-b border-border bg-surface-2 px-2 py-1.5 overflow-x-auto scrollbar-none">
      {/* Project name — click pencil to rename */}
      <div className="mr-1 flex items-center gap-1">
        {editingName ? (
          <input
            ref={nameRef}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              else if (e.key === 'Escape') setEditingName(false);
              e.stopPropagation();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="h-6 min-w-[120px] max-w-[200px] flex-1 rounded border border-accent bg-surface px-1.5 text-xs text-content outline-none transition-colors focus:ring-1 focus:ring-accent/50"
          />
        ) : (
          <span
            className="max-w-[180px] truncate text-xs font-semibold text-content"
            title={projectName}
          >
            {projectName}
          </span>
        )}
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={editingName ? commitRename : beginRename}
          className="rounded p-0.5 text-content-muted transition-colors hover:text-content"
          title="프로젝트명 변경"
        >
          <Pencil size={13} />
        </button>
      </div>
      <div className="mx-1 h-4 w-px bg-border" />
      <Group>
        <Button size="sm" variant="accent" onClick={() => addTask(firstSelectedId())} title="작업 추가">
          <Plus size={14} /> 작업
        </Button>
        <Button size="sm" onClick={duplicateSelected} disabled={selectedCount === 0} title="복제 (Ctrl+D)">
          <Copy size={14} />
        </Button>
        {cancelState === 'all-cancelled' ? (
          <Button
            size="sm"
            variant="danger"
            onClick={deleteSelected}
            disabled={selectedCount === 0}
            title="영구 삭제 (Del) — 취소된 일정을 완전히 제거합니다"
          >
            <Trash2 size={14} /> 삭제
          </Button>
        ) : (
          <Button
            size="sm"
            variant="danger"
            onClick={deleteSelected}
            disabled={selectedCount === 0}
            title="취소 처리 (Del) — 한 번 더 누르면 영구 삭제"
          >
            <Ban size={14} /> 취소
          </Button>
        )}
        {cancelState === 'all-cancelled' && (
          <Button
            size="sm"
            onClick={uncancelSelected}
            disabled={selectedCount === 0}
            title="취소 해제 — 일정을 다시 활성화합니다"
          >
            <RotateCcw size={14} /> 복구
          </Button>
        )}
        <Button size="sm" onClick={moveUpSelected} disabled={selectedCount === 0} title="위로 이동 (Alt+↑)">
          <ArrowUp size={14} />
        </Button>
        <Button size="sm" onClick={moveDownSelected} disabled={selectedCount === 0} title="아래로 이동 (Alt+↓)">
          <ArrowDown size={14} />
        </Button>
        <Button size="sm" onClick={indentSelected} disabled={selectedCount === 0} title="들여쓰기 (Tab)">
          <Indent size={14} />
        </Button>
        <Button size="sm" onClick={outdentSelected} disabled={selectedCount === 0} title="내어쓰기 (Shift+Tab)">
          <Outdent size={14} />
        </Button>
      </Group>

      <Divider />

      <Group>
        <Button size="sm" onClick={undo} disabled={past === 0} title="실행 취소 (Ctrl+Z)">
          <Undo2 size={14} />
        </Button>
        <Button size="sm" onClick={redo} disabled={future === 0} title="다시 실행 (Ctrl+Y)">
          <Redo2 size={14} />
        </Button>
      </Group>

      <Divider />

      <Group>
        <Button size="sm" onClick={() => zoomBy(-1)} title="차트 축소 (Ctrl+-)">
          <ZoomOut size={14} />
        </Button>
        <select
          value={view.zoom}
          onChange={(e) => setZoom(e.target.value as ZoomLevel)}
          className="h-7 rounded-md border border-border bg-surface px-1 text-xs text-content outline-none transition-colors hover:border-content-muted/60 focus:border-accent"
          aria-label="확대 단계"
        >
          {ZOOM_ORDER.slice()
            .reverse()
            .map((z) => (
              <option key={z} value={z}>
                {ZOOM_LABELS[z]}
              </option>
            ))}
        </select>
        <Button size="sm" onClick={() => zoomBy(1)} title="차트 확대 (Ctrl+=)">
          <ZoomIn size={14} />
        </Button>
      </Group>

      <Divider />

      <Group>
        <Button size="sm" active={view.showCriticalPath} onClick={toggleCritical} title="크리티컬 패스 — 가장 긴 경로(지연 불가) 강조">
          <Route size={14} /> 크리티컬
        </Button>
        <Button size="sm" active={view.showTodayLine} onClick={toggleTodayLine} title="오늘 선 표시/숨기기">
          <CalendarClock size={14} /> 오늘
        </Button>
        <Button size="sm" onClick={onOpenBaselines} title="베이스라인">
          <FlagTriangleRight size={14} /> 베이스라인
        </Button>
        <Button size="sm" onClick={onOpenMarkers} title="차트 마커">
          <MapPin size={14} /> 마커
        </Button>
      </Group>

      <Divider />

      <Group>
        <Button size="sm" onClick={() => setActiveView('gantt')} active={view.activeView === 'gantt'}>
          간트
        </Button>
        <Button size="sm" onClick={() => setActiveView('resources')} active={view.activeView === 'resources'}>
          리소스
        </Button>
        <Button size="sm" onClick={() => setActiveView('calendar')} active={view.activeView === 'calendar'}>
          달력
        </Button>
        <Button size="sm" onClick={() => setActiveView('groups')} active={view.activeView === 'groups'}>
          그룹 요약
        </Button>
      </Group>

      <Divider />

      <Group>
        <select
          value={view.filterMode === 'group' ? `group:${view.filterGroupId}` : view.filterMode}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'all') setViewFilter('all');
            else if (v === 'focus') setViewFilter('focus');
            else if (v.startsWith('group:')) setViewFilter('group', v.slice(6));
          }}
          className="h-7 max-w-[150px] rounded-md border border-border bg-surface px-1 text-xs text-content outline-none transition-colors hover:border-content-muted/60 focus:border-accent"
          aria-label="보기 필터"
          title="표시할 작업 필터"
        >
          <option value="all">전체 보기</option>
          <option value="focus" disabled={selectedCountForFilter === 0}>
            선택 항목만{selectedCountForFilter > 0 ? ` (${selectedCountForFilter})` : ''}
          </option>
          {viewGroups.length > 0 && (
            <optgroup label="보기 그룹">
              {viewGroups.map((g) => (
                <option key={g.id} value={`group:${g.id}`}>
                  {g.name} ({g.taskIds.length})
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <Button size="sm" onClick={onOpenViewGroups} title="보기 그룹 관리">
          <Layers size={14} /> 그룹
        </Button>
        <AssigneeFilterButton />
      </Group>

      <Divider />

      <Group>
        <Button size="sm" onClick={onOpenResources} title="담당자 관리">
          <Users size={14} /> 담당자
        </Button>
        <Button size="sm" onClick={onOpenHolidays} title="공휴일 설정">
          <CalendarRange size={14} /> 공휴일
        </Button>
        <Button size="sm" onClick={onOpenCalendar} title="근무 달력 설정">
          <Settings2 size={14} /> 달력
        </Button>
      </Group>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {/* Export dropdown */}
        <ExportDropdown onExport={exportNow} onShare={() => void shareExport()} />
        <Divider />
        <Button size="sm" onClick={() => useProjectStore.getState().newProject()} title="새 프로젝트 (Ctrl+N)">
          <FilePlus2 size={14} />
        </Button>
        <Button size="sm" onClick={() => void shareImport()} title="파일 열기 (Ctrl+O)">
          <FolderOpen size={14} /> 열기
        </Button>
        <Button
          size="sm"
          variant={dirty ? 'accent' : 'default'}
          onClick={() => void saveProject()}
          title={currentFilePath ? `저장 — ${currentFilePath} (Ctrl+S)` : '저장 (Ctrl+S)'}
        >
          <Save size={14} /> {dirty ? '저장 ●' : '저장'}
        </Button>
        <Button size="sm" onClick={() => void saveAsProject()} title="다른 이름으로 저장 (Ctrl+Shift+S)">
          <FolderInput size={14} />
        </Button>
        <Divider />
        <Button size="icon" variant="ghost" onClick={toggleTheme} title={view.theme === 'dark' ? '라이트 테마로 전환' : '다크 테마로 전환'}>
          {view.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </Button>
      </div>
    </div>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1">{children}</div>;
}

function Divider() {
  return <div className="mx-1 h-5 w-px bg-border" />;
}

// ---------------------------------------------------------------------------
// Assignee filter dropdown
// ---------------------------------------------------------------------------

function AssigneeFilterButton() {
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
        className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-all select-none ${
          isActive
            ? 'border-accent/40 bg-accent/15 text-accent'
            : 'border-border bg-surface-2 text-content hover:bg-surface-3'
        }`}
        title="담당자별 필터"
      >
        <span>담당자{isActive ? ` (${activeSet.size})` : ''}</span>
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

function ExportDropdown({ onExport, onShare }: ExportDropdownProps) {
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
        title="내보내기"
      >
        <Download size={14} />
        <span>내보내기</span>
        <ChevronDown size={11} className={`transition-transform text-content-muted ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && createPortal(
        <div
          style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-100%)', zIndex: 9999 }}
          className="min-w-[180px] rounded-md border border-border bg-surface shadow-xl text-xs py-1"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-wider text-content-muted border-b border-border mb-1">
            내보내기
          </div>
          {([
            { kind: 'excel' as const, icon: <FileSpreadsheet size={13} />, label: 'Excel (.xlsx)' },
            { kind: 'html'  as const, icon: <Globe size={13} />,          label: 'HTML (인터랙티브)' },
            { kind: 'png'   as const, icon: <Image size={13} />,          label: 'PNG 이미지' },
            { kind: 'pdf'   as const, icon: <FileText size={13} />,       label: 'PDF 문서' },
          ]).map(({ kind, icon, label }) => (
            <button
              key={kind}
              onClick={() => void run(() => onExport(kind))}
              className="flex w-full items-center gap-2.5 px-3 py-1.5 hover:bg-surface-2 text-content"
            >
              <span className="text-content-muted">{icon}</span>
              {label}
            </button>
          ))}
          <div className="my-1 border-t border-border" />
          <button
            onClick={() => { setOpen(false); onShare(); }}
            className="flex w-full items-center gap-2.5 px-3 py-1.5 hover:bg-surface-2 text-content"
          >
            <span className="text-content-muted"><Download size={13} /></span>
            공유 파일 (.smgantt)
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

function firstSelectedId(): string | undefined {
  const ids = useProjectStore.getState().selectedTaskIds;
  return ids.size ? [...ids][ids.size - 1] : undefined;
}

/** Apply a per-task action to every selected task. */
function useSelectedAction(action: 'indentTask' | 'outdentTask' | 'moveTaskUp' | 'moveTaskDown'): () => void {
  const fn = useProjectStore((s) => s[action]);
  return () => {
    const ids = useProjectStore.getState().selectedTaskIds;
    for (const id of ids) fn(id);
  };
}
