import { useEffect, useState } from 'react';
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
import { ViewFilterBanner } from '@/features/view/ViewFilterBanner';
import { createDemoProject } from '@/data/sampleData';
import { autosaveRepository } from '@/services/persistence/projectRepository';
import { Button } from '@/shared/ui/Button';

type DialogKind = 'projects' | 'holidays' | 'resources' | 'calendar' | 'baselines' | 'viewGroups' | null;

/**
 * Application shell. Wires the toolbar, split-pane grid+gantt (or resource
 * view), status bar and dialogs, and handles project bootstrap + crash
 * recovery on first mount.
 */
export default function App() {
  useTheme();
  useKeyboardShortcuts();

  const gridWidth = useProjectStore((s) => s.view.gridWidth);
  const activeView = useProjectStore((s) => s.view.activeView);
  const loadProject = useProjectStore((s) => s.loadProject);

  const [dialog, setDialog] = useState<DialogKind>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [recovery, setRecovery] = useState<null | (() => void)>(null);

  // Bootstrap: load the demo project, and offer crash recovery if an autosave
  // from a previous (possibly crashed) session is present.
  useEffect(() => {
    loadProject(createDemoProject());
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

  return (
    <div className="flex h-full flex-col bg-surface text-content">
      <Toolbar
        onOpenProjects={() => setDialog('projects')}
        onOpenHolidays={() => setDialog('holidays')}
        onOpenResources={() => setDialog('resources')}
        onOpenCalendar={() => setDialog('calendar')}
        onOpenBaselines={() => setDialog('baselines')}
        onOpenViewGroups={() => setDialog('viewGroups')}
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
            <SplitDivider />
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
      <TaskInspector />
      <ConfirmDeleteDialog />
    </div>
  );
}
