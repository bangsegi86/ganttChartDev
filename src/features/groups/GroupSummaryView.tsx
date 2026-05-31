import { useMemo } from 'react';
import { Layers } from 'lucide-react';
import { useProjectStore } from '@/app/store/useProjectStore';
import { diffDaysISO, todayISO } from '@/shared/date/dateUtils';
import { Button } from '@/shared/ui/Button';
import type { Task, ViewGroup } from '@/entities';

interface GroupStats {
  group: ViewGroup;
  tasks: Task[];
  avgProgress: number;
  completedCount: number;
  overdueCount: number;
  inProgressCount: number;
  earliestStart: string | null;
  latestEnd: string | null;
  totalDurationDays: number;
}

function computeStats(group: ViewGroup, allTasks: Task[], today: string): GroupStats {
  const tasks = allTasks.filter((t) => group.taskIds.includes(t.id) && !t.isMilestone);
  const totalDurationDays = tasks.reduce((s, t) => s + Math.max(1, t.durationDays), 0);
  const avgProgress =
    totalDurationDays > 0
      ? tasks.reduce((s, t) => s + t.progress * Math.max(1, t.durationDays), 0) / totalDurationDays
      : 0;
  const completedCount = tasks.filter((t) => t.progress >= 100).length;
  const overdueCount = tasks.filter((t) => t.end < today && t.progress < 100).length;
  const inProgressCount = tasks.filter((t) => t.progress > 0 && t.progress < 100).length;
  const starts = tasks.map((t) => t.start).sort();
  const ends = tasks.map((t) => t.end).sort();
  return {
    group,
    tasks,
    avgProgress,
    completedCount,
    overdueCount,
    inProgressCount,
    earliestStart: starts[0] ?? null,
    latestEnd: ends[ends.length - 1] ?? null,
    totalDurationDays,
  };
}

/** Group progress summary dashboard. */
export function GroupSummaryView() {
  const project = useProjectStore((s) => s.derived.project);
  const setViewFilter = useProjectStore((s) => s.setViewFilter);
  const setActiveView = useProjectStore((s) => s.setActiveView);
  const filterGroupId = useProjectStore((s) => s.view.filterGroupId);
  const filterMode = useProjectStore((s) => s.view.filterMode);
  const today = todayISO();

  const stats = useMemo<GroupStats[]>(
    () => project.viewGroups.map((g) => computeStats(g, project.tasks, today)),
    [project.viewGroups, project.tasks, today],
  );

  if (project.viewGroups.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-surface p-8 text-center">
        <Layers size={32} className="text-content-muted" />
        <p className="text-sm text-content-muted">보기 그룹이 없습니다.</p>
        <p className="text-xs text-content-muted">
          간트 뷰에서 작업을 선택하고 툴바의 그룹 버튼으로 그룹을 만들어 보세요.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex-1 overflow-auto bg-surface p-4">
      <h2 className="mb-4 text-sm font-semibold text-content">그룹별 진척 현황</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => {
          const isActive = filterMode === 'group' && filterGroupId === s.group.id;
          const pct = Math.round(s.avgProgress);
          const span =
            s.earliestStart && s.latestEnd
              ? `${diffDaysISO(s.earliestStart, s.latestEnd) + 1}일`
              : '—';
          return (
            <div
              key={s.group.id}
              className="flex flex-col rounded-xl border border-border bg-surface-2 p-4"
              style={{ borderLeftColor: s.group.color, borderLeftWidth: 4 }}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.group.color }} />
                  <span className="truncate text-sm font-semibold text-content">{s.group.name}</span>
                </div>
                <span className="shrink-0 text-2xs text-content-muted">{s.tasks.length}개 작업</span>
              </div>

              {/* Progress bar */}
              <div className="mb-3">
                <div className="mb-1 flex justify-between text-2xs text-content-muted">
                  <span>평균 진척률</span>
                  <span className="font-semibold text-content">{pct}%</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${pct}%`, background: s.group.color }}
                  />
                </div>
              </div>

              {/* Stats grid */}
              <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                <StatCell
                  label="완료"
                  value={`${s.completedCount}`}
                  sub={`/ ${s.tasks.length}`}
                  color={s.completedCount > 0 ? 'text-emerald-400' : undefined}
                />
                <StatCell
                  label="진행 중"
                  value={`${s.inProgressCount}`}
                  color={s.inProgressCount > 0 ? 'text-accent' : undefined}
                />
                <StatCell
                  label="지연"
                  value={`${s.overdueCount}`}
                  color={s.overdueCount > 0 ? 'text-critical' : undefined}
                />
              </div>

              {/* Date range */}
              {s.earliestStart && s.latestEnd && (
                <div className="mb-3 rounded-md bg-surface px-2 py-1.5 text-2xs text-content-muted">
                  <span>{s.earliestStart}</span>
                  <span className="mx-1">→</span>
                  <span>{s.latestEnd}</span>
                  <span className="ml-2 text-content-muted/70">({span})</span>
                </div>
              )}

              <div className="mt-auto flex gap-2">
                <Button
                  size="sm"
                  active={isActive}
                  onClick={() => {
                    setViewFilter(isActive ? 'all' : 'group', s.group.id);
                    if (!isActive) setActiveView('gantt');
                  }}
                  className="flex-1"
                >
                  {isActive ? '필터 해제' : '이 그룹만 보기'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-md bg-surface px-1 py-1.5">
      <div className={`text-sm font-bold ${color ?? 'text-content'}`}>
        {value}
        {sub && <span className="text-2xs font-normal text-content-muted">{sub}</span>}
      </div>
      <div className="text-2xs text-content-muted">{label}</div>
    </div>
  );
}
