import { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '@/app/store/useProjectStore';
import { useTheme } from '@/shared/hooks/useTheme';
import { useKeyboardShortcuts } from '@/shared/hooks/useKeyboardShortcuts';
import { Toolbar } from '@/features/toolbar/Toolbar';
import { StatusBar } from '@/features/statusbar/StatusBar';
import { DataGrid } from '@/features/grid/DataGrid';
import { GanttChart } from '@/features/gantt/GanttChart';
import { ResourceView } from '@/features/resources/ResourceView';
import { CalendarMonthView } from '@/features/calendar/CalendarMonthView';
import { GroupSummaryView } from '@/features/groups/GroupSummaryView';
import { SplitDivider } from '@/shared/ui/SplitDivider';
import { HolidayManager } from '@/features/dialogs/HolidayManager';
import { ResourceManager } from '@/features/dialogs/ResourceManager';
import { CalendarSettings } from '@/features/dialogs/CalendarSettings';
import { BaselineManager } from '@/features/dialogs/BaselineManager';
import { ViewGroupManager } from '@/features/dialogs/ViewGroupManager';
import { TaskInspector } from '@/features/dialogs/TaskInspector';
import { ConfirmDeleteDialog } from '@/features/dialogs/ConfirmDeleteDialog';
import { ProjectManagerDialog } from '@/features/dialogs/ProjectManagerDialog';
import { MarkerManager } from '@/features/dialogs/MarkerManager';
import { ViewFilterBanner } from '@/features/view/ViewFilterBanner';
import { autosaveRepository } from '@/services/persistence/projectRepository';
import { Button } from '@/shared/ui/Button';
import { bridge } from '@/shared/bridge';
import { exportExcel } from '@/services/export/exportExcel';
import { exportPdf, exportPng } from '@/services/export/exportImage';

type DialogKind = 'projects' | 'holidays' | 'resources' | 'calendar' | 'baselines' | 'viewGroups' | 'markers' | null;

/**
 * Application shell. Wires the toolbar, split-pane grid+gantt (or resource
 * view), status bar and dialogs, and handles project bootstrap + crash
 * recovery on first mount.
 */
export default function App() {
  useTheme();
  useKeyboardShortcuts();

  const gridWidth = useProjectStore((s) => s.view.gridWidth);
  const gridCollapsed = useProjectStore((s) => s.view.gridCollapsed);
  const activeView = useProjectStore((s) => s.view.activeView);
  const loadProject = useProjectStore((s) => s.loadProject);

  const [dialog, setDialog] = useState<DialogKind>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [recovery, setRecovery] = useState<null | (() => void)>(null);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);

  const appToast = useProjectStore((s) => s.view.appToast);
  const clearAppToast = useProjectStore((s) => s.clearAppToast);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!appToast) return;
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => clearAppToast(), 4500);
    return () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); };
  }, [appToast?.id, clearAppToast]);

  // On startup just check for autosave crash recovery — do not load a demo project.
  useEffect(() => {
    void (async () => {
      const recovered = await autosaveRepository.read();
      if (recovered && recovered.tasks.length > 0) {
        setRecovery(() => () => {
          loadProject(recovered);
          setRecovery(null);
        });
      }
    })();
  }, [loadProject]);

  // Persist on window close so nothing is lost between sessions.
  useEffect(() => {
    const handler = () => void useProjectStore.getState().flushAutosave();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Native app menu → dispatch to store / toolbar actions.
  useEffect(() => {
    return bridge().menu.onAction(async (action) => {
      try {
        const state = useProjectStore.getState();
        const { project, schedules } = state.derived;
        const name = project.name || '간트';
        if (action === 'menu:new-project') {
          state.newProject();
        } else if (action === 'menu:open-file') {
          await state.shareImport();
        } else if (action === 'menu:open-projects') {
          setDialog('projects');
        } else if (action === 'menu:save') {
          void state.saveProject();
        } else if (action === 'menu:save-as') {
          void state.saveAsProject();
        } else if (action === 'menu:export-excel') {
          state.showAppToast('Excel 내보내기 중...', 'success');
          await exportExcel(project, name, {
            project, schedules,
            zoom: state.view.zoom, theme: state.view.theme,
            showCritical: state.view.showCriticalPath, showBaseline: state.view.showBaseline,
          });
          state.clearAppToast();
        } else if (action === 'menu:export-png') {
          state.showAppToast('PNG 이미지 내보내기 중...', 'success');
          await exportPng({ project, schedules, zoom: state.view.zoom, theme: state.view.theme, showCritical: state.view.showCriticalPath, showBaseline: state.view.showBaseline }, name);
          state.clearAppToast();
        } else if (action === 'menu:export-pdf') {
          state.showAppToast('PDF 내보내기 중...', 'success');
          await exportPdf({ project, schedules, zoom: state.view.zoom, theme: state.view.theme, showCritical: state.view.showCriticalPath, showBaseline: state.view.showBaseline }, name);
          state.clearAppToast();
        } else if (action === 'menu:zoom-in') {
          state.scaleDayWidth(1.2);
        } else if (action === 'menu:zoom-out') {
          state.scaleDayWidth(1 / 1.2);
        } else if (action === 'menu:zoom-reset') {
          state.setDayWidthScale(1.0);
        } else if (action === 'menu:share-export') {
          await state.shareExport();
        } else if (action === 'menu:share-import') {
          await state.shareImport();
        } else if (action === 'menu:show-shortcuts') {
          setShortcutsOpen(true);
        } else if (action === 'menu:close-requested') {
          if (useProjectStore.getState().dirty) {
            setCloseConfirmOpen(true);
          } else {
            bridge().menu.confirmClose();
          }
        }
      } catch (err) {
        console.error('Menu action error:', err);
        useProjectStore.getState().showAppToast('작업 중 오류가 발생했습니다.', 'error');
      }
    });
  }, []);

  const handleSaveAndClose = async () => {
    setCloseConfirmOpen(false);
    await useProjectStore.getState().saveProject();
    bridge().menu.confirmClose();
  };

  const handleDiscardAndClose = () => {
    setCloseConfirmOpen(false);
    bridge().menu.confirmClose();
  };

  return (
    <div className="flex h-full flex-col bg-surface text-content">
      <Toolbar
        onOpenHolidays={() => setDialog('holidays')}
        onOpenResources={() => setDialog('resources')}
        onOpenCalendar={() => setDialog('calendar')}
        onOpenBaselines={() => setDialog('baselines')}
        onOpenViewGroups={() => setDialog('viewGroups')}
        onOpenMarkers={() => setDialog('markers')}
      />

      {recovery && (
        <div className="flex items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-content">
          이전 세션의 자동 저장본이 있습니다. 복구하시겠습니까?
          <Button size="sm" variant="accent" onClick={recovery}>
            복구
          </Button>
          <Button size="sm" onClick={() => { void autosaveRepository.clear(); setRecovery(null); }}>
            무시
          </Button>
        </div>
      )}

      <ViewFilterBanner onManageGroups={() => setDialog('viewGroups')} />

      <div className="flex min-h-0 flex-1">
        {activeView === 'resources' ? (
          <ResourceView />
        ) : activeView === 'calendar' ? (
          <CalendarMonthView />
        ) : activeView === 'groups' ? (
          <GroupSummaryView />
        ) : (
          <>
            <DataGrid width={gridWidth} scrollTop={scrollTop} onScrollTopChange={setScrollTop} />
            {!gridCollapsed && <SplitDivider />}
            <GanttChart scrollTop={scrollTop} onScrollTopChange={setScrollTop} />
          </>
        )}
      </div>

      <StatusBar />

      <ProjectManagerDialog open={dialog === 'projects'} onClose={() => setDialog(null)} />
      <HolidayManager open={dialog === 'holidays'} onClose={() => setDialog(null)} />
      <ResourceManager open={dialog === 'resources'} onClose={() => setDialog(null)} />
      <CalendarSettings open={dialog === 'calendar'} onClose={() => setDialog(null)} />
      <BaselineManager open={dialog === 'baselines'} onClose={() => setDialog(null)} />
      <ViewGroupManager open={dialog === 'viewGroups'} onClose={() => setDialog(null)} />
      <MarkerManager open={dialog === 'markers'} onClose={() => setDialog(null)} />
      <TaskInspector />
      <ConfirmDeleteDialog />

      {/* Unsaved-changes guard — shown when user clicks X with pending edits */}
      {closeConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-80 rounded-xl border border-border bg-surface-2 p-6 shadow-2xl">
            <h2 className="mb-1 text-sm font-semibold text-content">저장하지 않은 변경 사항</h2>
            <p className="mb-5 text-xs text-content-muted">
              저장되지 않은 변경 사항이 있습니다. 닫기 전에 저장하시겠습니까?
            </p>
            <div className="flex flex-col gap-2">
              <Button size="sm" variant="accent" className="w-full justify-center" onClick={() => void handleSaveAndClose()}>
                저장하고 닫기
              </Button>
              <Button size="sm" variant="danger" className="w-full justify-center" onClick={handleDiscardAndClose}>
                저장 안 하고 닫기
              </Button>
              <Button size="sm" className="w-full justify-center" onClick={() => setCloseConfirmOpen(false)}>
                취소
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard shortcuts reference dialog */}
      {shortcutsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onMouseDown={() => setShortcutsOpen(false)}
        >
          <div
            className="w-[480px] max-h-[80vh] overflow-auto rounded-xl border border-border bg-surface-2 p-6 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-sm font-semibold text-content">키보드 단축키</h2>
            <ShortcutsTable />
            <div className="mt-4 flex justify-end">
              <Button size="sm" onClick={() => setShortcutsOpen(false)}>닫기</Button>
            </div>
          </div>
        </div>
      )}

      {/* App-level toast notification */}
      {appToast && (
        <div
          className={`fixed bottom-8 left-1/2 z-[9999] -translate-x-1/2 rounded-full border px-5 py-2 text-xs font-medium shadow-xl transition-all ${
            appToast.type === 'error'
              ? 'border-red-500/40 bg-red-500/10 text-red-400'
              : 'border-green-500/40 bg-green-500/10 text-green-400'
          }`}
        >
          {appToast.msg}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts reference table
// ---------------------------------------------------------------------------

const SHORTCUTS = [
  { section: '일반' },
  { key: 'Ctrl+S', desc: '저장' },
  { key: 'Ctrl+Z', desc: '실행 취소' },
  { key: 'Ctrl+Y / Ctrl+Shift+Z', desc: '다시 실행' },
  { key: 'Ctrl+N', desc: '새 프로젝트' },
  { key: 'Ctrl+O', desc: '파일 열기' },
  { section: '편집' },
  { key: 'Enter / F2', desc: '셀 편집' },
  { key: 'Delete', desc: '선택 항목 삭제 (취소 처리)' },
  { key: 'Ctrl+D', desc: '복제' },
  { key: 'Ctrl+X', desc: '잘라내기 (이동 준비)' },
  { key: 'Tab', desc: '들여쓰기 (하위 작업으로)' },
  { key: 'Shift+Tab', desc: '내어쓰기 (상위로 이동)' },
  { key: 'Alt+↑/↓', desc: '행 위/아래 이동' },
  { section: '보기' },
  { key: 'Ctrl+=', desc: '차트 확대' },
  { key: 'Ctrl+-', desc: '차트 축소' },
  { key: 'Ctrl+0', desc: '차트 비율 초기화' },
  { key: 'Ctrl+Wheel', desc: '마우스 위치 기준 확대/축소' },
  { section: '차트' },
  { key: '드래그', desc: '바 이동 (날짜 변경)' },
  { key: '바 끝 드래그', desc: '기간 조정' },
  { key: 'Alt+드래그', desc: '의존성 연결' },
  { key: '더블클릭', desc: '작업 상세 검사' },
  { key: 'Space+드래그', desc: '패닝 (pan)' },
];

function ShortcutsTable() {
  return (
    <div className="text-xs text-content">
      {SHORTCUTS.map((row, i) =>
        'section' in row ? (
          <div key={i} className="mt-3 mb-1 text-2xs font-semibold uppercase tracking-wider text-content-muted first:mt-0">
            {row.section}
          </div>
        ) : (
          <div key={i} className="flex items-center gap-3 py-0.5">
            <kbd className="min-w-[120px] rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-2xs text-content-muted">
              {row.key}
            </kbd>
            <span>{row.desc}</span>
          </div>
        ),
      )}
    </div>
  );
}
