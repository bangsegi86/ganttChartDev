import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  BarChart3,
  CalendarDays,
  CalendarRange,
  ChevronsUpDown,
  CircleHelp,
  Copy,
  FilePlus2,
  FolderInput,
  FolderOpen,
  GanttChartSquare,
  LayoutGrid,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Save,
  Settings2,
  Sun,
  Users,
} from 'lucide-react';
import { useProjectStore, type ActiveView } from '@/app/store/useProjectStore';
import { newProjectSafely, openProjectSafely } from '@/app/guardUnsaved';
import { tipProps } from '@/shared/ui/Tooltip';
import { cn } from '@/shared/ui/cn';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';

export interface SidebarProps {
  onOpenResources: () => void;
  onOpenCalendar: () => void;
  onOpenHolidays: () => void;
  onOpenViewGroups: () => void;
  onOpenHelp: () => void;
}

/**
 * Left navigation (design B): project menu, screens, view groups and project
 * settings. Collapses to an icon rail on narrow windows or on request.
 */
export function Sidebar({ onOpenResources, onOpenCalendar, onOpenHolidays, onOpenViewGroups, onOpenHelp }: SidebarProps) {
  const pref = useProjectStore((s) => s.view.sidebarCollapsed);
  const narrow = useMediaQuery('(max-width: 1199px)');
  const collapsed = pref || narrow;
  const toggleSidebar = useProjectStore((s) => s.toggleSidebar);
  const activeView = useProjectStore((s) => s.view.activeView);
  const setActiveView = useProjectStore((s) => s.setActiveView);
  const theme = useProjectStore((s) => s.view.theme);
  const toggleTheme = useProjectStore((s) => s.toggleTheme);
  const viewGroups = useProjectStore((s) => s.derived.project.viewGroups);
  const filterMode = useProjectStore((s) => s.view.filterMode);
  const filterGroupId = useProjectStore((s) => s.view.filterGroupId);
  const setViewFilter = useProjectStore((s) => s.setViewFilter);

  const views: { id: ActiveView; label: string; icon: ReactNode; desc: string }[] = [
    { id: 'gantt', label: '간트 차트', icon: <GanttChartSquare size={16} />, desc: '작업 목록과 일정 막대를 나란히 봅니다.' },
    { id: 'resources', label: '담당자별 업무량', icon: <BarChart3 size={16} />, desc: '담당자마다 주별로 일이 얼마나 몰려 있는지 봅니다.' },
    { id: 'calendar', label: '달력', icon: <CalendarDays size={16} />, desc: '월 달력 위에 작업을 표시합니다.' },
  ];

  return (
    <nav
      aria-label="화면과 설정"
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-150',
        collapsed ? 'w-14' : 'w-[232px]',
      )}
    >
      {/* Logo + collapse */}
      <div className={cn('flex h-[52px] shrink-0 items-center gap-2', collapsed ? 'justify-center' : 'px-4')}>
        {!collapsed && (
          <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-bold">
            <AppLogo />
            <span className="truncate">Smart Gantt</span>
          </span>
        )}
        {!narrow && (
          <button
            onClick={toggleSidebar}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-content-muted hover:bg-surface-3 hover:text-content"
            {...tipProps(collapsed ? '메뉴 펼치기' : '메뉴 접기', collapsed ? '왼쪽 메뉴를 넓혀 이름까지 보여 줍니다.' : '왼쪽 메뉴를 아이콘만 남기고 줄여 차트를 넓게 봅니다.')}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        )}
      </div>

      <ProjectMenu collapsed={collapsed} />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden pb-2">
        <SectionLabel collapsed={collapsed}>화면</SectionLabel>
        {views.map((v) => (
          <NavItem
            key={v.id}
            collapsed={collapsed}
            active={activeView === v.id}
            icon={v.icon}
            label={v.label}
            desc={v.desc}
            onClick={() => setActiveView(v.id)}
          />
        ))}

        <div className={cn('flex items-center pt-4', collapsed ? 'justify-center' : 'justify-between pl-4 pr-3')}>
          {!collapsed && <span className="pb-1 text-2xs font-semibold text-content-muted">보기 그룹</span>}
          <button
            onClick={onOpenViewGroups}
            className="mb-1 flex h-6 w-6 items-center justify-center rounded text-content-muted hover:bg-surface-3 hover:text-content"
            {...tipProps('보기 그룹 만들기·관리', '자주 함께 보는 작업을 묶어 이름을 붙여 둡니다. 상위·하위 작업 구조와는 별개이고 일정에 영향을 주지 않습니다.')}
          >
            <Plus size={14} />
          </button>
        </div>
        {!collapsed && viewGroups.length === 0 && (
          <p className="mx-4 mb-1 text-2xs leading-relaxed text-content-muted [word-break:keep-all]">
            작업을 오른쪽 클릭 → 보기 그룹으로 만들 수 있어요.
          </p>
        )}
        {viewGroups.map((g) => {
          const active = activeView === 'gantt' && filterMode === 'group' && filterGroupId === g.id;
          return (
            <NavItem
              key={g.id}
              collapsed={collapsed}
              active={active}
              icon={<span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />}
              label={g.name}
              count={g.taskIds.length}
              desc="이 보기 그룹의 작업만 보여 줍니다. 다시 누르면 모든 작업을 봅니다."
              onClick={() => {
                if (active) setViewFilter('all');
                else { setActiveView('gantt'); setViewFilter('group', g.id); }
              }}
            />
          );
        })}
        <NavItem
          collapsed={collapsed}
          active={activeView === 'groups'}
          icon={<LayoutGrid size={16} />}
          label="보기 그룹 현황"
          desc="보기 그룹마다 진척률, 지연된 작업 수, 기간을 한눈에 봅니다."
          onClick={() => setActiveView('groups')}
        />

        <div className="flex-1" />

        <SectionLabel collapsed={collapsed}>프로젝트 설정</SectionLabel>
        <NavItem collapsed={collapsed} icon={<Users size={16} />} label="담당자"
          desc="작업을 맡을 사람의 이름, 색, 하루 근무시간을 등록합니다." onClick={onOpenResources} />
        <NavItem collapsed={collapsed} icon={<Settings2 size={16} />} label="근무일 설정"
          desc="일하는 요일과, 기간을 근무일로 셀지 달력일로 셀지 정합니다." onClick={onOpenCalendar} />
        <NavItem collapsed={collapsed} icon={<CalendarRange size={16} />} label="공휴일"
          desc="쉬는 날로 칠 공휴일을 관리합니다. 대한민국 공휴일을 자동으로 넣을 수 있습니다." onClick={onOpenHolidays} />
        <NavItem collapsed={collapsed} icon={<CircleHelp size={16} />} label="도움말" shortcut="F1"
          desc="기능 설명, 엑셀 붙여넣기 방법, 단축키를 볼 수 있습니다." onClick={onOpenHelp} />
        <NavItem collapsed={collapsed} icon={theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          label={theme === 'dark' ? '밝은 화면' : '어두운 화면'} desc="화면 밝기를 바꿉니다." onClick={toggleTheme} />
      </div>
    </nav>
  );
}

export function AppLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
      <rect x="3" y="5" width="11" height="3.5" rx="1.5" fill="#2F6FEB" />
      <rect x="7" y="10.5" width="13" height="3.5" rx="1.5" fill="#E8590C" />
      <rect x="5" y="16" width="9" height="3.5" rx="1.5" fill="#0B8A6E" />
    </svg>
  );
}

function SectionLabel({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  if (collapsed) return <div className="mx-3 my-2 h-px bg-border" />;
  return <div className="px-4 pb-1 pt-3 text-2xs font-semibold text-content-muted">{children}</div>;
}

function NavItem({
  collapsed, active = false, icon, label, desc, count, shortcut, onClick,
}: {
  collapsed: boolean;
  active?: boolean;
  icon: ReactNode;
  label: string;
  desc: string;
  count?: number;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'mx-2 flex h-9 shrink-0 items-center gap-2.5 rounded-md text-left text-[13px] transition-colors',
        collapsed ? 'justify-center px-0' : 'px-2.5',
        active ? 'bg-accent/10 font-semibold text-accent' : 'text-content hover:bg-surface-3',
      )}
      {...tipProps(label, desc, shortcut)}
    >
      <span className={cn('flex w-4 shrink-0 items-center justify-center', active ? 'text-accent' : 'text-content-muted')}>
        {icon}
      </span>
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {!collapsed && count !== undefined && <span className="shrink-0 text-2xs text-content-muted">{count}</span>}
    </button>
  );
}

/** Project switcher: name, file actions, rename. */
function ProjectMenu({ collapsed }: { collapsed: boolean }) {
  const name = useProjectStore((s) => s.derived.project.name);
  const currentFilePath = useProjectStore((s) => s.currentFilePath);
  const renameProject = useProjectStore((s) => s.renameProject);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (document.getElementById('project-menu')?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: r.left });
    setOpen((o) => !o);
  };
  const run = (fn: () => unknown) => () => { setOpen(false); void fn(); };
  const fileName = currentFilePath ? currentFilePath.split(/[\\/]/).pop() : null;

  return (
    <>
      {renaming ? (
        <div className="mx-3 mb-3">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { setRenaming(false); if (draft.trim()) renameProject(draft.trim()); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') { setDraft(name); setRenaming(false); }
              e.stopPropagation();
            }}
            aria-label="프로젝트 이름"
            className="h-11 w-full rounded-lg border border-accent bg-surface px-3 text-[13px] font-semibold text-content outline-none"
          />
        </div>
      ) : (
        <button
          ref={btnRef}
          onClick={toggle}
          aria-expanded={open}
          className={cn(
            'mb-3 flex shrink-0 items-center rounded-lg border border-border bg-surface-2 text-left transition-colors hover:border-content-muted/50',
            collapsed ? 'mx-2 h-10 justify-center' : 'mx-3 h-11 justify-between gap-2 px-3',
          )}
          {...tipProps('프로젝트', `${name}${fileName ? ` · ${fileName}` : ' · 아직 파일로 저장하지 않음'}`)}
        >
          {collapsed ? (
            <FolderOpen size={16} className="text-content-muted" />
          ) : (
            <>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-semibold text-content">{name}</span>
                <span className="truncate text-2xs text-content-muted">{fileName ?? '새로 만들기 · 열기 · 저장'}</span>
              </span>
              <ChevronsUpDown size={14} className="shrink-0 text-content-muted" />
            </>
          )}
        </button>
      )}
      {open && createPortal(
        <div
          id="project-menu"
          role="menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
          className="w-60 rounded-lg border border-border bg-surface py-1 text-xs shadow-xl"
        >
          <MenuItem icon={<Pencil size={14} />} label="이름 바꾸기" onClick={() => { setOpen(false); setDraft(name); setRenaming(true); }} />
          <div className="my-1 h-px bg-border" />
          <MenuItem icon={<FilePlus2 size={14} />} label="새로 만들기" keys="Ctrl+N" onClick={run(newProjectSafely)} />
          <MenuItem icon={<FolderOpen size={14} />} label="열기…" keys="Ctrl+O" onClick={run(openProjectSafely)} />
          <MenuItem icon={<Save size={14} />} label="저장" keys="Ctrl+S" onClick={run(() => useProjectStore.getState().saveProject())} />
          <MenuItem icon={<FolderInput size={14} />} label="다른 이름으로 저장…" keys="Ctrl+Shift+S" onClick={run(() => useProjectStore.getState().saveAsProject())} />
          <MenuItem icon={<Copy size={14} />} label="사본 저장 (지금 파일은 그대로)" onClick={run(() => useProjectStore.getState().shareExport())} />
        </div>,
        document.body,
      )}
    </>
  );
}

function MenuItem({ icon, label, keys, onClick }: { icon: ReactNode; label: string; keys?: string; onClick: () => void }) {
  return (
    <button role="menuitem" onClick={onClick} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-content hover:bg-surface-2">
      <span className="shrink-0 text-content-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {keys && <kbd className="shrink-0 font-sans text-2xs text-content-muted">{keys}</kbd>}
    </button>
  );
}
