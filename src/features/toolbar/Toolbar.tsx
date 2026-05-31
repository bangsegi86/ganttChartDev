import {
  CalendarDays,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  FlagTriangleRight,
  Image,
  Indent,
  Layers,
  Moon,
  Outdent,
  Plus,
  Redo2,
  Route,
  Save,
  Sun,
  Trash2,
  Undo2,
  Users,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
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
  onOpenHolidays: () => void;
  onOpenResources: () => void;
  onOpenCalendar: () => void;
  onOpenBaselines: () => void;
  onOpenViewGroups: () => void;
}

/** Top command bar. Groups document, edit, view and export actions. */
export function Toolbar({
  onOpenHolidays,
  onOpenResources,
  onOpenCalendar,
  onOpenBaselines,
  onOpenViewGroups,
}: ToolbarProps) {
  const view = useProjectStore((s) => s.view);
  const viewGroups = useProjectStore((s) => s.derived.project.viewGroups);
  const setViewFilter = useProjectStore((s) => s.setViewFilter);
  const selectedCountForFilter = useProjectStore((s) => s.selectedTaskIds.size);
  const past = useProjectStore((s) => s.past.length);
  const future = useProjectStore((s) => s.future.length);
  const selectedCount = useProjectStore((s) => s.selectedTaskIds.size);
  const dirty = useProjectStore((s) => s.dirty);

  const addTask = useProjectStore((s) => s.addTask);
  const deleteSelected = useProjectStore((s) => s.deleteSelected);
  const duplicateSelected = useProjectStore((s) => s.duplicateSelected);
  const indentSelected = useSelectedAction('indentTask');
  const outdentSelected = useSelectedAction('outdentTask');
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const setZoom = useProjectStore((s) => s.setZoom);
  const zoomBy = useProjectStore((s) => s.zoomBy);
  const toggleCritical = useProjectStore((s) => s.toggleCriticalPath);
  const toggleTheme = useProjectStore((s) => s.toggleTheme);
  const saveProject = useProjectStore((s) => s.saveProject);
  const setActiveView = useProjectStore((s) => s.setActiveView);

  const exportNow = async (kind: 'excel' | 'png' | 'pdf') => {
    const state = useProjectStore.getState();
    const { project, schedules } = state.derived;
    const name = project.name || 'gantt';
    if (kind === 'excel') await exportExcel(project, name);
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
      <Group>
        <Button size="sm" variant="accent" onClick={() => addTask(firstSelectedId())} title="작업 추가">
          <Plus size={14} /> 작업
        </Button>
        <Button size="sm" onClick={duplicateSelected} disabled={selectedCount === 0} title="복제 (Ctrl+D)">
          <Copy size={14} />
        </Button>
        <Button size="sm" variant="danger" onClick={deleteSelected} disabled={selectedCount === 0} title="삭제 (Del)">
          <Trash2 size={14} />
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
          className="h-7 rounded-md border border-border bg-surface px-1 text-xs text-content"
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
          className="h-7 max-w-[150px] rounded-md border border-border bg-surface px-1 text-xs text-content"
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
        <Button size="sm" onClick={() => void exportNow('excel')} title="Excel 내보내기">
          <FileSpreadsheet size={14} />
        </Button>
        <Button size="sm" onClick={() => void exportNow('png')} title="PNG 내보내기">
          <Image size={14} />
        </Button>
        <Button size="sm" onClick={() => void exportNow('pdf')} title="PDF 내보내기">
          <FileText size={14} />
        </Button>
        <Divider />
        <Button size="sm" variant={dirty ? 'accent' : 'default'} onClick={() => void saveProject()} title="저장 (Ctrl+S)">
          <Save size={14} /> {dirty ? '저장*' : '저장'}
        </Button>
        <Button size="icon" variant="ghost" onClick={toggleTheme} title="테마 전환">
          {view.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </Button>
        <span className="hidden items-center gap-1 text-2xs text-content-muted md:flex">
          <Download size={12} />
        </span>
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

/** Apply an indent/outdent action to every selected task. */
function useSelectedAction(action: 'indentTask' | 'outdentTask'): () => void {
  const fn = useProjectStore((s) => s[action]);
  return () => {
    const ids = useProjectStore.getState().selectedTaskIds;
    for (const id of ids) fn(id);
  };
}
