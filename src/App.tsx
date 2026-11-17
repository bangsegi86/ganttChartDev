import { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '@/app/store/useProjectStore';
import { useTheme } from '@/shared/hooks/useTheme';
import { useKeyboardShortcuts } from '@/shared/hooks/useKeyboardShortcuts';
import { Sidebar } from '@/features/shell/Sidebar';
import { ActionBar, TopBar, ViewBar } from '@/features/shell/Bars';
import { ChartHint } from '@/features/shell/ChartHint';
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
import { MarkerManager } from '@/features/dialogs/MarkerManager';
import { ViewFilterBanner } from '@/features/view/ViewFilterBanner';
import { autosaveRepository } from '@/services/persistence/projectRepository';
import { useScrollSync } from '@/app/store/useScrollSync';
import { Button } from '@/shared/ui/Button';
import { bridge } from '@/shared/bridge';
import { HelpDialog, type HelpSection } from '@/features/help/HelpDialog';
import { ChoiceDialogHost } from '@/shared/ui/ChoiceDialog';
import { TooltipLayer, tipProps } from '@/shared/ui/Tooltip';
import { newProjectSafely, openProjectSafely } from '@/app/guardUnsaved';

type DialogKind = 'holidays' | 'resources' | 'calendar' | 'baselines' | 'viewGroups' | 'markers' | null;

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
  const [help, setHelp] = useState<{ open: boolean; section: HelpSection }>({ open: false, section: 'start' });
  const openHelp = (section: HelpSection = 'start') => setHelp({ open: true, section });

  // F1 opens the guide from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') { e.preventDefault(); setHelp({ open: true, section: 'start' }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [recovery, setRecovery] = useState<null | (() => void)>(null);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);

  const appToast = useProjectStore((s) => s.view.appToast);
  const clearAppToast = useProjectStore((s) => s.clearAppToast);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!appToast) return;
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    // Longer messages stay longer (≈ reading time), 4.5–12 s.
    const ms = Math.min(12_000, 4_500 + appToast.msg.length * 45);
    toastTimerRef.current = setTimeout(() => clearAppToast(), ms);
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
          await newProjectSafely();
        } else if (action === 'menu:open-file') {
          await openProjectSafely();
        } else if (action === 'menu:save') {
          void state.saveProject();
        } else if (action === 'menu:save-as') {
          void state.saveAsProject();
        } else if (action === 'menu:export-excel') {
          state.showAppToast('Excel 내보내기 중...', 'success');
          // Export libraries (ExcelJS, jsPDF) load on first use, not at startup.
          const { exportExcel } = await import('@/services/export/exportExcel');
          await exportExcel(project, name, {
            project, schedules,
            zoom: state.view.zoom, theme: state.view.theme,
            showCritical: state.view.showCriticalPath, showBaseline: state.view.showBaseline,
          });
          state.clearAppToast();
        } else if (action === 'menu:export-png') {
          state.showAppToast('PNG 이미지 내보내기 중...', 'success');
          const { exportPng, warnIfTruncated } = await import('@/services/export/exportImage');
          const r = await exportPng({ project, schedules, zoom: state.view.zoom, theme: state.view.theme, showCritical: state.view.showCriticalPath, showBaseline: state.view.showBaseline }, name);
          state.clearAppToast();
          warnIfTruncated(r);
        } else if (action === 'menu:export-pdf') {
          state.showAppToast('PDF 내보내기 중...', 'success');
          const { exportPdf, warnIfTruncated } = await import('@/services/export/exportImage');
          const r = await exportPdf({ project, schedules, zoom: state.view.zoom, theme: state.view.theme, showCritical: state.view.showCriticalPath, showBaseline: state.view.showBaseline }, name);
          state.clearAppToast();
          warnIfTruncated(r);
        } else if (action === 'menu:zoom-in') {
          state.scaleDayWidth(1.2);
        } else if (action === 'menu:zoom-out') {
          state.scaleDayWidth(1 / 1.2);
        } else if (action === 'menu:zoom-reset') {
          state.setDayWidthScale(1.0);
        } else if (action === 'menu:share-export') {
          await state.shareExport();
        } else if (action === 'menu:share-import') {
          await openProjectSafely();
        } else if (action === 'menu:show-shortcuts') {
          openHelp('keys');
        } else if (action === 'menu:show-help') {
          openHelp('start');
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
    <div className="flex h-full bg-surface text-content">
      <Sidebar
        onOpenResources={() => setDialog('resources')}
        onOpenCalendar={() => setDialog('calendar')}
        onOpenHolidays={() => setDialog('holidays')}
        onOpenViewGroups={() => setDialog('viewGroups')}
        onOpenHelp={() => openHelp()}
      />
      <main className="flex min-w-0 flex-1 flex-col">
      <TopBar />

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

      {activeView === 'gantt' && (
        <>
          <ViewBar onOpenBaselines={() => setDialog('baselines')} onOpenMarkers={() => setDialog('markers')} />
          <ActionBar />
        </>
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
            <SyncedDataGrid width={gridWidth} />
            {!gridCollapsed && <SplitDivider />}
            <div className="relative flex min-w-0 flex-1">
              <SyncedGanttChart />
              <ChartHint />
            </div>
          </>
        )}
      </div>

      <StatusBar />
      </main>

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

      <HelpDialog open={help.open} initialSection={help.section} onClose={() => setHelp((h) => ({ ...h, open: false }))} />
      <ChoiceDialogHost />
      <TooltipLayer />

      {/* App-level toast notification */}
      {appToast && (
        <div
          role={appToast.type === 'error' ? 'alert' : 'status'}
          onClick={clearAppToast}
          className={`fixed bottom-8 left-1/2 z-[9999] max-w-[min(640px,90vw)] -translate-x-1/2 cursor-pointer whitespace-pre-line rounded-xl border px-5 py-2.5 text-xs font-medium leading-relaxed shadow-xl backdrop-blur transition-all ${
            appToast.type === 'error'
              ? 'border-red-500/40 bg-surface/95 text-red-400'
              : appToast.type === 'info'
                ? 'border-accent/40 bg-surface/95 text-content'
                : 'border-green-500/40 bg-surface/95 text-green-400'
          }`}
          {...tipProps('알림', '클릭하면 닫힙니다.')}
        >
          {appToast.msg}
        </div>
      )}
    </div>
  );
}

/** Grid pane bound to the shared scroll offset (keeps scroll re-renders local). */
function SyncedDataGrid({ width }: { width: number }) {
  const scrollTop = useScrollSync((s) => s.scrollTop);
  const setScrollTop = useScrollSync((s) => s.setScrollTop);
  return <DataGrid width={width} scrollTop={scrollTop} onScrollTopChange={setScrollTop} />;
}

/** Gantt pane bound to the shared scroll offset. */
function SyncedGanttChart() {
  const scrollTop = useScrollSync((s) => s.scrollTop);
  const setScrollTop = useScrollSync((s) => s.setScrollTop);
  return <GanttChart scrollTop={scrollTop} onScrollTopChange={setScrollTop} />;
}
