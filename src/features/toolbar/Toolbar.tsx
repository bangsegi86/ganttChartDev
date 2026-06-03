import {
  ArrowDown,
  ArrowUp,
  Ban,
  CalendarDays,
  Copy,
  Download,
  FilePlus2,
  FolderInput,
  FileSpreadsheet,
  FileText,
  FlagTriangleRight,
  FolderOpen,
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
  Sun,
  Trash2,
  Undo2,
  Users,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useState, useRef } from 'react';
import { useProjectStore } from '@/app/store/useProjectStore';
import { Button } from '@/shared/ui/Button';
import { ZOOM_ORDER, type ZoomLevel } from '@/features/gantt/zoom';
import { exportExcel } from '@/services/export/exportExcel';
import { exportPdf, exportPng } from '@/services/export/exportImage';

const ZOOM_LABELS: Record<ZoomLevel, string> = {
  hour: '시간',
  day: '일',
  week: '주',
  month: '월',
  quarter: '분기',
  year: '연',
};

interface ToolbarProps {
  onOpenProjects: () => void;
  onOpenHolidays: () => void;
  onOpenResources: () => void;
  onOpenCalendar: () => void;
  onOpenBaselines: () => void;
  onOpenViewGroups: () => void;
  onOpenMarkers: () => void;
}

/** Top command bar. Groups document, edit, view and export actions. */
export function Toolbar({
  onOpenProjects,
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
  const toggleCritical = useProjectStore((s) => s.toggleCriticalPath);
  const toggleTheme = useProjectStore((s) => s.toggleTheme);
  const saveProject = useProjectStore((s) => s.saveProject);
  const shareExport = useProjectStore((s) => s.shareExport);
  const shareImport = useProjectStore((s) => s.shareImport);
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

  const exportNow = async (kind: 'excel' | 'png' | 'pdf') => {
    const state = useProjectStore.getState();
    const { project, schedules } = state.derived;
    const name = project.name || 'gantt';
    if (kind === 'excel') await exportExcel(project, name, {
      project,
      schedules,
      zoom: state.view.zoom,
      theme: state.view.theme,
      showCritical: state.view.showCriticalPath,
      showBaseline: state.view.showBaseline,
    });
    else {
      const input = {
        project,
        schedules,
        zoom: state.view.zoom,
        theme: state.view.theme,
        showCritical: state.view.showCriticalPath,
        showBaseline: state.view.showBaseline,
      };
      if (kind === 'png') await exportPng(input, name);
      else await exportPdf(input, name);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border bg-surface-2 px-2 py-1.5">
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
        <Button size="sm" onClick={() => zoomBy(-1)} title="축소 (-)">
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
        <Button size="sm" onClick={() => zoomBy(1)} title="확대 (+)">
          <ZoomIn size={14} />
        </Button>
      </Group>

      <Divider />

      <Group>
        <Button size="sm" active={view.showCriticalPath} onClick={toggleCritical} title="크리티컬 패스">
          <Route size={14} /> CP
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
      </Group>

      <Divider />

      <Group>
        <Button size="sm" onClick={onOpenResources} title="담당자 관리">
          <Users size={14} />
        </Button>
        <Button size="sm" onClick={onOpenHolidays} title="공휴일 관리">
          <CalendarDays size={14} />
        </Button>
        <Button size="sm" onClick={onOpenCalendar} title="달력 설정">
          <CalendarDays size={14} /> 설정
        </Button>
      </Group>

      <div className="ml-auto flex items-center gap-1">
        <Button size="sm" onClick={() => void exportNow('excel')} title="엑셀 내보내기">
          <FileSpreadsheet size={14} />
        </Button>
        <Button size="sm" onClick={() => void exportNow('png')} title="PNG 내보내기">
          <Image size={14} />
        </Button>
        <Button size="sm" onClick={() => void exportNow('pdf')} title="PDF 내보내기">
          <FileText size={14} />
        </Button>
        <Divider />
        <Button size="sm" onClick={() => void shareExport()} title="파일로 내보내기 (.smgantt) — 다른 사람과 공유 (Ctrl+Shift+E)">
          <Download size={14} /> 공유
        </Button>
        <Button size="sm" onClick={() => void shareImport()} title="파일 가져오기 (.smgantt) — 다른 사람의 파일 열기 (Ctrl+Shift+I)">
          <FolderInput size={14} /> 가져오기
        </Button>
        <Divider />
        <Button size="sm" onClick={() => useProjectStore.getState().newProject()} title="새 프로젝트">
          <FilePlus2 size={14} />
        </Button>
        <Button size="sm" onClick={onOpenProjects} title="프로젝트 열기">
          <FolderOpen size={14} /> 열기
        </Button>
        <Button size="sm" variant={dirty ? 'accent' : 'default'} onClick={() => void saveProject()} title="저장 (Ctrl+S)">
          <Save size={14} /> {dirty ? '저장*' : '저장'}
        </Button>
        <Button size="icon" variant="ghost" onClick={toggleTheme} title="테마 전환">
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
