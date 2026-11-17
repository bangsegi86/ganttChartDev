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
  CircleHelp,
  GanttChartSquare,
  BarChart3,
  CalendarDays,
  LayoutGrid,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useProjectStore } from '@/app/store/useProjectStore';
import { Button } from '@/shared/ui/Button';
import { tipProps } from '@/shared/ui/Tooltip';
import { newProjectSafely, openProjectSafely } from '@/app/guardUnsaved';
import { ZOOM_ORDER, type ZoomLevel } from '@/features/gantt/zoom';

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
  onOpenHelp: () => void;
}

/** Top command bar. Groups document, edit, view and export actions. */
export function Toolbar({
  onOpenHolidays,
  onOpenResources,
  onOpenCalendar,
  onOpenBaselines,
  onOpenViewGroups,
  onOpenMarkers,
  onOpenHelp,
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
  };

  const rowCls = 'flex items-end gap-1 border-b border-border bg-surface-2 px-2 pt-1 pb-0.5 overflow-x-auto scrollbar-none';
  const selHint = selectedCount === 0 ? ' (먼저 작업을 선택하세요)' : '';

  return (
    <div className="flex flex-col shrink-0">
      {/* ── 1줄: 파일 · 작업 편집 · 위치 · 되돌리기 ── */}
      <div className={rowCls}>
        {/* 프로젝트명 */}
        <div className="mr-1 flex shrink-0 items-center gap-1 self-center">
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
              className="h-6 min-w-[120px] max-w-[200px] rounded border border-accent bg-surface px-1.5 text-xs text-content outline-none focus:ring-1 focus:ring-accent/50"
            />
          ) : (
            <button
              onClick={beginRename}
              className="max-w-[160px] truncate rounded px-1 text-xs font-semibold text-content hover:bg-surface-3"
              {...tipProps(projectName, '클릭하면 프로젝트 이름을 바꿀 수 있습니다.')}
            >
              {projectName}
            </button>
          )}
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={editingName ? commitRename : beginRename}
            className="rounded p-0.5 text-content-muted transition-colors hover:text-content"
            {...tipProps('프로젝트 이름 바꾸기')}
          >
            <Pencil size={12} />
          </button>
        </div>

        <Divider />

        <Group label="파일">
          <Button size="sm" onClick={() => void newProjectSafely()}
            tip="새 프로젝트" tipKeys="Ctrl+N"
            tipDesc="빈 프로젝트를 새로 시작합니다. 저장하지 않은 내용이 있으면 먼저 저장할지 묻습니다.">
            <FilePlus2 size={14} /> 새로 만들기
          </Button>
          <Button size="sm" onClick={() => void openProjectSafely()}
            tip="열기" tipKeys="Ctrl+O" tipDesc="저장해 둔 프로젝트 파일(.smgantt)을 엽니다.">
            <FolderOpen size={14} /> 열기
          </Button>
          <Button
            size="sm"
            variant={dirty ? 'accent' : 'default'}
            onClick={() => void saveProject()}
            tip={dirty ? '저장 (저장하지 않은 변경 있음)' : '저장'}
            tipKeys="Ctrl+S"
            tipDesc={currentFilePath
              ? `지금 파일에 덮어씁니다: ${currentFilePath}`
              : '처음 저장할 때는 저장할 위치와 파일 이름을 묻습니다.'}
          >
            <Save size={14} /> 저장{dirty ? ' ●' : ''}
          </Button>
          <Button size="sm" onClick={() => void saveAsProject()}
            tip="다른 이름으로 저장" tipKeys="Ctrl+Shift+S"
            tipDesc="다른 위치나 이름으로 저장하고, 이후에는 그 파일에서 계속 작업합니다.">
            <FolderInput size={14} /> <span className="hidden wide:inline">다른 이름으로</span>
          </Button>
        </Group>

        <Divider />

        <Group label="작업">
          <Button size="sm" variant="accent" onClick={() => addTask(firstSelectedId())}
            tip="작업 추가"
            tipDesc="선택한 작업 바로 아래에 새 작업을 만듭니다. 선택한 작업이 없으면 맨 아래에 만듭니다. 표에서 오른쪽 클릭해도 추가할 수 있습니다.">
            <Plus size={14} /> 작업 추가
          </Button>
          <Button size="sm" onClick={duplicateSelected} disabled={selectedCount === 0}
            tip={'복제' + selHint} tipKeys="Ctrl+D"
            tipDesc="선택한 작업을 하위 작업까지 그대로 복사해 바로 아래에 붙입니다.">
            <Copy size={14} /> 복제
          </Button>
          {cancelState === 'all-cancelled' ? (
            <>
              <Button size="sm" onClick={uncancelSelected}
                tip="취소 해제" tipDesc="'취소됨' 표시를 없애고 다시 일정 계산에 넣습니다.">
                <RotateCcw size={14} /> 취소 해제
              </Button>
              <Button size="sm" variant="danger" onClick={deleteSelected}
                tip="영구 삭제" tipKeys="Del"
                tipDesc="취소된 작업을 목록에서 완전히 지웁니다. 실수했다면 되돌리기(Ctrl+Z)로 살릴 수 있습니다.">
                <Trash2 size={14} /> 영구 삭제
              </Button>
            </>
          ) : (
            <Button size="sm" variant="danger" onClick={deleteSelected} disabled={selectedCount === 0}
              tip={'작업 취소' + selHint} tipKeys="Del"
              tipDesc="선택한 작업을 '취소됨'(회색 줄)으로 표시해 일정 계산에서 뺍니다. 취소된 작업을 다시 선택하면 영구 삭제할 수 있습니다.">
              <Ban size={14} /> 작업 취소
            </Button>
          )}
        </Group>

        <Divider />

        <Group label="위치·단계">
          <Button size="sm" onClick={moveUpSelected} disabled={selectedCount === 0}
            tip={'위로' + selHint} tipKeys="Alt+↑" tipDesc="같은 그룹 안에서 순서를 한 칸 올립니다.">
            <ArrowUp size={14} /> <span className="hidden wide:inline">위로</span>
          </Button>
          <Button size="sm" onClick={moveDownSelected} disabled={selectedCount === 0}
            tip={'아래로' + selHint} tipKeys="Alt+↓" tipDesc="같은 그룹 안에서 순서를 한 칸 내립니다.">
            <ArrowDown size={14} /> <span className="hidden wide:inline">아래로</span>
          </Button>
          <Button size="sm" onClick={indentSelected} disabled={selectedCount === 0}
            tip={'하위 작업으로' + selHint} tipKeys="Tab"
            tipDesc="바로 위 작업 밑으로 한 단계 들여 넣습니다. 위 작업은 하위 작업을 묶는 그룹이 되고, 기간이 자동으로 합산됩니다.">
            <Indent size={14} /> 하위로
          </Button>
          <Button size="sm" onClick={outdentSelected} disabled={selectedCount === 0}
            tip={'상위로 꺼내기' + selHint} tipKeys="Shift+Tab"
            tipDesc="그룹 밖으로 한 단계 꺼냅니다.">
            <Outdent size={14} /> 상위로
          </Button>
        </Group>

        <Divider />

        <Group label="기록">
          <Button size="sm" onClick={undo} disabled={past === 0}
            tip="되돌리기" tipKeys="Ctrl+Z" tipDesc="방금 한 변경을 취소합니다. 100단계까지 되돌릴 수 있습니다.">
            <Undo2 size={14} /> <span className="hidden wide:inline">되돌리기</span>
          </Button>
          <Button size="sm" onClick={redo} disabled={future === 0}
            tip="다시 실행" tipKeys="Ctrl+Y" tipDesc="되돌린 변경을 다시 적용합니다.">
            <Redo2 size={14} /> <span className="hidden wide:inline">다시 실행</span>
          </Button>
        </Group>

        {/* 오른쪽: 내보내기 · 테마 · 도움말 */}
        <div className="ml-auto flex shrink-0 items-center gap-1 self-center pl-2">
          <ExportDropdown onExport={exportNow} onShare={() => void shareExport()} />
          <Divider />
          <Button size="icon" variant="ghost" onClick={toggleTheme}
            tip={view.theme === 'dark' ? '밝은 화면으로' : '어두운 화면으로'}>
            {view.theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </Button>
          <Button size="sm" onClick={onOpenHelp}
            tip="도움말" tipKeys="F1" tipDesc="기능 설명, 엑셀 붙여넣기 방법, 단축키를 볼 수 있습니다.">
            <CircleHelp size={14} /> 도움말
          </Button>
        </div>
      </div>

      {/* ── 2줄: 화면 · 배율 · 차트 표시 · 보기 범위 · 프로젝트 설정 ── */}
      <div className={rowCls}>
        <Group label="화면">
          <Button size="sm" onClick={() => setActiveView('gantt')} active={view.activeView === 'gantt'}
            tip="간트 차트" tipDesc="작업 목록과 일정 막대를 나란히 봅니다.">
            <GanttChartSquare size={14} className="hidden wide:block" /> 간트
          </Button>
          <Button size="sm" onClick={() => setActiveView('resources')} active={view.activeView === 'resources'}
            tip="담당자별 업무량" tipDesc="담당자마다 주별로 일이 얼마나 몰려 있는지 봅니다. 하루 근무시간을 넘으면 빨갛게 표시됩니다.">
            <BarChart3 size={14} className="hidden wide:block" /> 업무량
          </Button>
          <Button size="sm" onClick={() => setActiveView('calendar')} active={view.activeView === 'calendar'}
            tip="달력" tipDesc="월 달력 위에 작업을 표시합니다.">
            <CalendarDays size={14} className="hidden wide:block" /> 달력
          </Button>
          <Button size="sm" onClick={() => setActiveView('groups')} active={view.activeView === 'groups'}
            tip="보기 그룹 현황" tipDesc="보기 그룹마다 진척률, 지연된 작업 수, 기간을 한눈에 봅니다.">
            <LayoutGrid size={14} className="hidden wide:block" /> 보기 그룹 현황
          </Button>
        </Group>

        <Divider />

        <Group label="눈금 (확대·축소)">
          <Button size="sm" onClick={() => zoomBy(-1)}
            tip="축소" tipKeys="Ctrl+-" tipDesc="한 화면에 더 긴 기간을 봅니다. Ctrl+마우스 휠로도 조절할 수 있습니다.">
            <ZoomOut size={14} />
          </Button>
          <select
            value={view.zoom}
            onChange={(e) => setZoom(e.target.value as ZoomLevel)}
            className="h-7 rounded-md border border-border bg-surface px-1 text-xs text-content outline-none transition-colors hover:border-content-muted/60 focus:border-accent"
            {...tipProps('눈금 단위', '차트 위쪽 날짜 눈금의 단위를 고릅니다.')}
          >
            {ZOOM_ORDER.slice().reverse().map((z) => (
              <option key={z} value={z}>{ZOOM_LABELS[z]} 단위</option>
            ))}
          </select>
          <Button size="sm" onClick={() => zoomBy(1)}
            tip="확대" tipKeys="Ctrl+=" tipDesc="날짜를 더 자세히 봅니다.">
            <ZoomIn size={14} />
          </Button>
        </Group>

        <Divider />

        <Group label="차트에 표시">
          <Button size="sm" active={view.showCriticalPath} onClick={toggleCritical}
            tip="크리티컬 패스 (켜기/끄기)"
            tipDesc="늦어지면 프로젝트 완료일도 함께 늦어지는 작업들을 빨간색으로 표시합니다.">
            <Route size={14} className="hidden wide:block" /> 크리티컬 패스
          </Button>
          <Button size="sm" active={view.showTodayLine} onClick={toggleTodayLine}
            tip="오늘 선 (켜기/끄기)" tipDesc="차트에 오늘 날짜를 빨간 점선으로 표시합니다.">
            <CalendarClock size={14} className="hidden wide:block" /> 오늘 선
          </Button>
          <Button size="sm" onClick={onOpenBaselines}
            tip="계획 비교 (베이스라인)"
            tipDesc="지금 일정을 '기준 계획'으로 저장해 두고, 나중에 실제 일정이 얼마나 달라졌는지 차트에서 비교합니다.">
            <FlagTriangleRight size={14} className="hidden wide:block" /> 계획 비교
          </Button>
          <Button size="sm" onClick={onOpenMarkers}
            tip="날짜 표시선" tipDesc="마감일, 회의일 같은 날짜에 이름 붙인 세로선을 그어 둡니다.">
            <MapPin size={14} className="hidden wide:block" /> 날짜 표시선
          </Button>
        </Group>

        <Divider />

        <Group label="볼 작업 고르기">
          <select
            value={view.filterMode === 'group' ? `group:${view.filterGroupId}` : view.filterMode}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'all') setViewFilter('all');
              else if (v === 'focus') setViewFilter('focus');
              else if (v.startsWith('group:')) setViewFilter('group', v.slice(6));
            }}
            className="h-7 max-w-[128px] rounded-md border border-border bg-surface px-1 text-xs text-content outline-none transition-colors hover:border-content-muted/60 focus:border-accent"
            {...tipProps('볼 작업 고르기', '모든 작업, 지금 선택한 작업만, 또는 보기 그룹 하나만 골라서 볼 수 있습니다. 작업 자체는 지워지지 않습니다.')}
          >
            <option value="all">모든 작업</option>
            <option value="focus" disabled={selectedCountForFilter === 0}>
              선택한 작업만{selectedCountForFilter > 0 ? ` (${selectedCountForFilter})` : ''}
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
          <Button size="sm" onClick={onOpenViewGroups}
            tip="보기 그룹 관리"
            tipDesc="자주 함께 보는 작업들을 골라 이름을 붙여 둡니다. 상위·하위 작업 구조와는 별개라서 일정에 영향을 주지 않습니다.">
            <Layers size={14} className="hidden wide:block" /> 보기 그룹
          </Button>
          <AssigneeFilterButton />
        </Group>

        <Divider />

        <Group label="프로젝트 설정">
          <Button size="sm" onClick={onOpenResources}
            tip="담당자 관리" tipDesc="작업에 지정할 사람의 이름, 색, 하루 근무시간을 등록합니다.">
            <Users size={14} className="hidden wide:block" /> 담당자 관리
          </Button>
          <Button size="sm" onClick={onOpenHolidays}
            tip="공휴일" tipDesc="일정 계산에서 쉬는 날로 칠 공휴일을 관리합니다.">
            <CalendarRange size={14} className="hidden wide:block" /> 공휴일
          </Button>
          <Button size="sm" onClick={onOpenCalendar}
            tip="근무일 설정" tipDesc="근무하는 요일, 공휴일을 뺄지, 기간을 근무일로 셀지 달력일로 셀지 정합니다.">
            <Settings2 size={14} className="hidden wide:block" /> 근무일 설정
          </Button>
        </Group>
      </div>
    </div>
  );
}

function Group({ label, children }: { label?: string; children: React.ReactNode }) {
  if (!label) return <div className="flex items-center gap-1">{children}</div>;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex items-center gap-1">{children}</div>
      <span className="text-[10px] leading-none text-content-muted/80 select-none">{label}</span>
    </div>
  );
}

function Divider() {
  return <div className="mx-0.5 h-5 w-px shrink-0 self-center bg-border" />;
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
