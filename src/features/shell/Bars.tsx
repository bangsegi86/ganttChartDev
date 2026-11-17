import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowUp,
  Ban,
  Check,
  ChevronDown,
  ClipboardPaste,
  Copy,
  Indent,
  Outdent,
  Plus,
  Redo2,
  RotateCcw,
  Scissors,
  Search,
  SquareStack,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { useProjectStore } from '@/app/store/useProjectStore';
import { tipProps } from '@/shared/ui/Tooltip';
import { cn } from '@/shared/ui/cn';
import { todayISO } from '@/shared/date/dateUtils';
import { ZOOM_ORDER, type ZoomLevel } from '@/features/gantt/zoom';
import { gridCommands, useCutStore } from '@/features/grid/gridCommands';
import { AssigneeFilterButton, ExportDropdown, ZOOM_LABELS, firstSelectedId, runExport, useSelectedAction } from './menus';

const VIEW_TITLES = { gantt: '간트 차트', resources: '담당자별 업무량', calendar: '달력', groups: '보기 그룹 현황' } as const;

/** A plain toolbar button that never wraps its label. */
function Btn({
  children, onClick, disabled, primary, danger, tip, desc, keys, className,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  tip: string;
  desc?: string;
  keys?: string;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        primary
          ? 'bg-accent font-semibold text-accent-fg enabled:hover:opacity-90'
          : danger
            ? 'border border-critical/40 bg-surface text-critical enabled:hover:bg-critical/5'
            : 'border border-border bg-surface text-content enabled:hover:bg-surface-3',
        className,
      )}
      {...tipProps(tip, desc, keys)}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Top bar: where am I, is it saved, undo/redo, export, save
// ---------------------------------------------------------------------------

export function TopBar() {
  const activeView = useProjectStore((s) => s.view.activeView);
  const dirty = useProjectStore((s) => s.dirty);
  const updatedAt = useProjectStore((s) => s.derived.project.updatedAt);
  const currentFilePath = useProjectStore((s) => s.currentFilePath);
  const past = useProjectStore((s) => s.past.length);
  const future = useProjectStore((s) => s.future.length);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const shareExport = useProjectStore((s) => s.shareExport);

  // Re-render every 30 s so "n분 전" stays current.
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(id); }, []);

  let status: ReactNode;
  if (dirty) {
    status = (
      <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-[#B5470B] dark:text-orange-300">
        <span className="h-2 w-2 rounded-full bg-[#E8590C]" />저장하지 않은 변경 있음
      </span>
    );
  } else if (currentFilePath) {
    status = (
      <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-success">
        <Check size={13} strokeWidth={2.5} />저장됨 · {relativeTime(updatedAt)}
      </span>
    );
  } else {
    status = <span className="shrink-0 whitespace-nowrap text-xs text-content-muted">아직 파일로 저장하지 않음</span>;
  }

  return (
    <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border bg-surface px-5">
      <h1 className="mr-1 min-w-0 truncate text-base font-bold">{VIEW_TITLES[activeView]}</h1>
      {status}
      <div className="min-w-2 flex-1" />
      <Btn onClick={undo} disabled={past === 0} tip="되돌리기" keys="Ctrl+Z" desc="방금 한 변경을 취소합니다. 100단계까지 되돌릴 수 있습니다.">
        <Undo2 size={15} className="text-content-muted" /><span className="hidden xl:inline">되돌리기</span>
      </Btn>
      <Btn onClick={redo} disabled={future === 0} tip="다시 실행" keys="Ctrl+Y" desc="되돌린 변경을 다시 적용합니다." className="px-2">
        <Redo2 size={15} className="text-content-muted" />
      </Btn>
      <ExportDropdown onExport={runExport} onShare={() => void shareExport()} />
      <Btn primary onClick={() => void useProjectStore.getState().saveProject()} tip="저장" keys="Ctrl+S"
        desc={currentFilePath ? `지금 파일에 덮어씁니다: ${currentFilePath}` : '처음 저장할 때는 저장할 위치와 파일 이름을 묻습니다.'}>
        저장
      </Btn>
    </div>
  );
}

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const min = Math.floor((Date.now() - t) / 60_000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 전`;
  return iso.slice(0, 10);
}

// ---------------------------------------------------------------------------
// View bar (gantt): search, who, what to show on the chart, scale, today
// ---------------------------------------------------------------------------

export function ViewBar({ onOpenBaselines, onOpenMarkers }: { onOpenBaselines: () => void; onOpenMarkers: () => void }) {
  const nameFilter = useProjectStore((s) => s.view.nameFilter);
  const setNameFilter = useProjectStore((s) => s.setNameFilter);
  const zoom = useProjectStore((s) => s.view.zoom);
  const setZoom = useProjectStore((s) => s.setZoom);
  const scrollGanttToDate = useProjectStore((s) => s.scrollGanttToDate);
  const filterMode = useProjectStore((s) => s.view.filterMode);
  const filterGroupId = useProjectStore((s) => s.view.filterGroupId);
  const viewGroups = useProjectStore((s) => s.derived.project.viewGroups);
  const selectedCount = useProjectStore((s) => s.selectedTaskIds.size);
  const setViewFilter = useProjectStore((s) => s.setViewFilter);

  const scale: ZoomLevel[] = ZOOM_ORDER.slice().reverse();

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-5 py-2">
      <label className="flex h-8 w-40 shrink-0 items-center gap-2 xl:w-56 rounded-md border border-border bg-surface px-2.5 focus-within:border-accent">
        <Search size={14} className="shrink-0 text-content-muted" />
        <input
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          placeholder="작업 이름으로 찾기"
          aria-label="작업 이름으로 찾기"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-content outline-none placeholder:text-content-muted"
        />
        {nameFilter && (
          <button onClick={() => setNameFilter('')} aria-label="검색어 지우기" className="shrink-0 text-content-muted hover:text-content"><X size={13} /></button>
        )}
      </label>

      <select
        value={filterMode === 'group' ? `group:${filterGroupId}` : filterMode === 'assignee' ? 'all' : filterMode}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'all') setViewFilter('all');
          else if (v === 'focus') setViewFilter('focus');
          else if (v.startsWith('group:')) setViewFilter('group', v.slice(6));
        }}
        className="h-8 max-w-[180px] shrink-0 rounded-full border border-border bg-surface px-3 text-xs text-content outline-none hover:border-content-muted/60 focus:border-accent"
        {...tipProps('볼 작업', '모든 작업, 지금 선택한 작업만, 또는 보기 그룹 하나만 골라서 봅니다. 작업 자체는 지워지지 않습니다.')}
      >
        <option value="all">볼 작업: 모두</option>
        <option value="focus" disabled={selectedCount === 0}>
          선택한 작업만{selectedCount > 0 ? ` (${selectedCount})` : ''}
        </option>
        {viewGroups.length > 0 && (
          <optgroup label="보기 그룹">
            {viewGroups.map((g) => <option key={g.id} value={`group:${g.id}`}>{g.name} ({g.taskIds.length})</option>)}
          </optgroup>
        )}
      </select>
      <AssigneeFilterButton />
      <ChartOptions onOpenBaselines={onOpenBaselines} onOpenMarkers={onOpenMarkers} />

      <div className="flex-1" />

      {/* Scale + "today" stay together when the bar wraps. */}
      <div className="flex shrink-0 items-center gap-2">
      <div role="group" aria-label="눈금 단위" className="flex shrink-0 rounded-lg bg-surface-3 p-0.5">
        {scale.map((z) => (
          <button
            key={z}
            onClick={() => setZoom(z)}
            aria-pressed={zoom === z}
            className={cn(
              'h-7 whitespace-nowrap rounded-md px-2.5 text-xs transition-colors',
              zoom === z ? 'bg-surface font-semibold text-content shadow-sm' : 'text-content-muted hover:text-content',
            )}
            {...tipProps(`${ZOOM_LABELS[z]} 단위로 보기`, 'Ctrl+마우스 휠로 더 세밀하게 확대·축소할 수 있습니다.')}
          >
            {ZOOM_LABELS[z]}
          </button>
        ))}
      </div>
      <Btn onClick={() => scrollGanttToDate(todayISO())} tip="오늘로 이동" desc="차트를 오늘 날짜가 보이는 곳으로 옮깁니다." className="font-semibold text-accent">
        오늘로
      </Btn>
      </div>
    </div>
  );
}

/** "차트에 표시 ▾" — overlays that can be turned on and off. */
function ChartOptions({ onOpenBaselines, onOpenMarkers }: { onOpenBaselines: () => void; onOpenMarkers: () => void }) {
  const view = useProjectStore((s) => s.view);
  const hasBaseline = useProjectStore((s) => !!s.derived.project.activeBaselineId);
  const markerCount = useProjectStore((s) => s.derived.project.markers?.length ?? 0);
  const toggleCritical = useProjectStore((s) => s.toggleCriticalPath);
  const toggleToday = useProjectStore((s) => s.toggleTodayLine);
  const toggleBaseline = useProjectStore((s) => s.toggleBaseline);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (document.getElementById('chart-options')?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const on = [view.showCriticalPath && '크리티컬 패스', view.showTodayLine && '오늘 선', view.showBaseline && hasBaseline && '계획 비교']
    .filter(Boolean) as string[];

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => {
          const r = btnRef.current?.getBoundingClientRect();
          if (r) setPos({ top: r.bottom + 4, left: r.left });
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        className="inline-flex h-8 max-w-[190px] shrink-0 items-center xl:max-w-[280px] gap-1.5 whitespace-nowrap rounded-full border border-border bg-surface px-3 text-xs text-content hover:border-content-muted/60"
        {...tipProps('차트에 표시', '크리티컬 패스, 오늘 선, 계획 비교, 날짜 표시선을 켜고 끕니다.')}
      >
        <span className="truncate">차트에 표시: {on.length ? on.join(', ') : '없음'}</span>
        <ChevronDown size={12} className="shrink-0 text-content-muted" />
      </button>
      {open && createPortal(
        <div id="chart-options" style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
          className="w-72 rounded-lg border border-border bg-surface p-1 text-xs shadow-xl">
          <Check2 checked={view.showCriticalPath} onChange={toggleCritical} label="크리티컬 패스"
            hint="늦어지면 완료일도 늦어지는 작업을 주황색으로 표시" />
          <Check2 checked={view.showTodayLine} onChange={toggleToday} label="오늘 선" hint="오늘 날짜에 세로 점선" />
          <Check2 checked={view.showBaseline && hasBaseline} disabled={!hasBaseline} onChange={toggleBaseline} label="계획 비교"
            hint={hasBaseline ? '저장해 둔 기준 계획을 막대 아래 회색 줄로 표시' : '먼저 아래에서 기준 계획을 저장하세요'} />
          <div className="my-1 h-px bg-border" />
          <button onClick={() => { setOpen(false); onOpenBaselines(); }} className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-content hover:bg-surface-2">
            <span>기준 계획 저장·관리…</span>
          </button>
          <button onClick={() => { setOpen(false); onOpenMarkers(); }} className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-content hover:bg-surface-2">
            <span>날짜 표시선 관리…</span><span className="text-content-muted">{markerCount}개</span>
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

function Check2({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: () => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 hover:bg-surface-2', disabled && 'cursor-not-allowed opacity-50')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[rgb(var(--color-accent))]" />
      <span className="flex min-w-0 flex-col">
        <span className="text-content">{label}</span>
        <span className="text-2xs leading-snug text-content-muted [word-break:keep-all]">{hint}</span>
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Action bar (gantt): always "add / paste"; selection tools appear on demand
// ---------------------------------------------------------------------------

export function ActionBar() {
  const addTask = useProjectStore((s) => s.addTask);
  const selectedIds = useProjectStore((s) => s.selectedTaskIds);
  const tasks = useProjectStore((s) => s.derived.project.tasks);
  const clearSelection = useProjectStore((s) => s.clearSelection);
  const duplicateSelected = useProjectStore((s) => s.duplicateSelected);
  const deleteSelected = useProjectStore((s) => s.deleteSelected);
  const uncancelSelected = useProjectStore((s) => s.uncancelSelected);
  const groupSelectedTasks = useProjectStore((s) => s.groupSelectedTasks);
  const indent = useSelectedAction('indentTask');
  const outdent = useSelectedAction('outdentTask');
  const moveUp = useSelectedAction('moveTaskUp');
  const moveDown = useSelectedAction('moveTaskDown');
  const cutIds = useCutStore((s) => s.ids);
  const setCutIds = useCutStore((s) => s.setIds);

  const n = selectedIds.size;
  const sel = tasks.filter((t) => selectedIds.has(t.id));
  const allCancelled = sel.length > 0 && sel.every((t) => t.cancelled);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-surface-2 px-5 py-2">
      <Btn primary onClick={() => addTask(firstSelectedId())} tip="작업 추가"
        desc="선택한 작업 바로 아래에 새 작업을 만듭니다. 선택한 작업이 없으면 맨 아래에 만듭니다.">
        <Plus size={15} strokeWidth={2.5} />작업 추가
      </Btn>
      <Btn onClick={() => gridCommands.run?.('v')} tip="엑셀 표 붙여넣기" keys="Ctrl+V"
        desc="엑셀에서 복사한 표를 붙여넣습니다. 표에서 칸을 먼저 클릭하면 그 칸부터 채우고, 아무것도 고르지 않으면 맨 아래에 새 작업으로 추가합니다.">
        <ClipboardPaste size={15} className="text-content-muted" />엑셀 표 붙여넣기
      </Btn>

      <div className="mx-1.5 h-6 w-px shrink-0 bg-border" />

      {cutIds.size > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-lg border border-[#F5B48F] bg-[#FFF2EA] py-1 pl-3 pr-1 dark:border-orange-400/40 dark:bg-orange-400/10">
          <span className="whitespace-nowrap text-[13px] font-semibold text-[#B5470B] dark:text-orange-300">잘라낸 작업 {cutIds.size}개</span>
          <span className="whitespace-nowrap text-xs text-[#8A3A0E] dark:text-orange-200">옮길 위치의 행을 클릭하고 Ctrl+V</span>
          <Btn onClick={() => gridCommands.run?.('v')} disabled={n === 0} tip="선택한 행 아래로 옮기기" keys="Ctrl+V"
            desc="잘라낸 작업을 지금 선택한 행 바로 아래(같은 단계)로 옮깁니다. 어떤 작업 안으로 넣으려면 그 작업을 오른쪽 클릭하세요.">
            여기로 옮기기
          </Btn>
          <button onClick={() => setCutIds(new Set())} className="h-8 whitespace-nowrap rounded-md px-2 text-xs text-[#8A3A0E] hover:bg-black/5 dark:text-orange-200" {...tipProps('잘라내기 취소', undefined, 'Esc')}>
            취소
          </button>
        </div>
      ) : n > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1 rounded-lg border border-accent/30 bg-accent/10 py-1 pl-3 pr-1">
          <span className="mr-1 whitespace-nowrap text-[13px] font-semibold text-accent">{n}개 선택됨</span>
          <SelBtn onClick={duplicateSelected} tip="복제" keys="Ctrl+D" desc="하위 작업과 그 안의 연결까지 통째로 복사해 바로 아래에 붙입니다."><Copy size={14} />복제</SelBtn>
          <SelBtn onClick={() => gridCommands.run?.('x')} tip="옮기기 (잘라내기)" keys="Ctrl+X" desc="옮길 위치의 행을 클릭하고 Ctrl+V를 누르면 그 행 바로 아래로 옮겨집니다."><Scissors size={14} />옮기기</SelBtn>
          <SelBtn onClick={moveUp} tip="위로" keys="Alt+↑" desc="같은 그룹 안에서 순서를 한 칸 올립니다."><ArrowUp size={14} /></SelBtn>
          <SelBtn onClick={moveDown} tip="아래로" keys="Alt+↓" desc="같은 그룹 안에서 순서를 한 칸 내립니다."><ArrowDown size={14} /></SelBtn>
          <SelBtn onClick={indent} tip="하위로" keys="Tab" desc="바로 위 작업 밑으로 한 단계 들여 넣습니다. 위 작업은 그룹이 됩니다."><Indent size={14} />하위로</SelBtn>
          <SelBtn onClick={outdent} tip="상위로" keys="Shift+Tab" desc="그룹 밖으로 한 단계 꺼냅니다."><Outdent size={14} />상위로</SelBtn>
          {n >= 2 && (
            <SelBtn onClick={groupSelectedTasks} tip="새 그룹으로 묶기" desc="같은 그룹 안에 있는 선택한 작업들을 새 그룹 하나로 묶습니다."><SquareStack size={14} />새 그룹으로 묶기</SelBtn>
          )}
          {allCancelled ? (
            <>
              <SelBtn onClick={uncancelSelected} tip="취소 해제" desc="'취소됨' 표시를 없애고 다시 일정 계산에 넣습니다."><RotateCcw size={14} />취소 해제</SelBtn>
              <SelBtn danger onClick={deleteSelected} tip="영구 삭제" keys="Del" desc="목록에서 완전히 지웁니다. 실수했다면 되돌리기(Ctrl+Z)로 살릴 수 있습니다."><Trash2 size={14} />영구 삭제</SelBtn>
            </>
          ) : (
            <SelBtn danger onClick={deleteSelected} tip="작업 취소" keys="Del" desc="'취소됨'(회색 줄)으로 표시해 일정 계산에서 뺍니다. 취소된 작업을 다시 고르면 영구 삭제할 수 있습니다."><Ban size={14} />작업 취소</SelBtn>
          )}
          <button onClick={clearSelection} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-accent hover:bg-accent/10" {...tipProps('선택 해제', undefined, 'Esc')}>
            <X size={15} />
          </button>
        </div>
      ) : (
        <span className="min-w-0 truncate text-xs text-content-muted">
          작업을 선택하면 복제·옮기기·하위로 같은 도구가 여기에 나타납니다. (Ctrl+클릭으로 여러 개 선택)
        </span>
      )}
    </div>
  );
}

function SelBtn({ children, onClick, tip, desc, keys, danger }: { children: ReactNode; onClick: () => void; tip: string; desc?: string; keys?: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-surface px-2.5 text-xs transition-colors hover:bg-surface-3',
        danger ? 'text-critical' : 'text-content',
      )}
      {...tipProps(tip, desc, keys)}
    >
      {children}
    </button>
  );
}
