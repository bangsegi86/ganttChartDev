import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useProjectStore } from '@/app/store/useProjectStore';
import { computeWorkload } from '@/services/resource/workload';

/**
 * Resource workload view. Shows each resource's weekly hours as a bar chart,
 * highlighting weeks containing over-allocated days (하루 capacity 초과).
 */
export function ResourceView() {
  const project = useProjectStore((s) => s.derived.project);
  const workloads = useMemo(() => computeWorkload(project), [project]);
  const maxWeekly = Math.max(
    1,
    ...workloads.flatMap((w) => w.weeks.map((wk) => wk.hours)),
  );

  return (
    <div className="h-full overflow-auto bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold text-content">리소스 업무량</h2>
      {project.resources.length === 0 && (
        <p className="text-xs text-content-muted">담당자를 먼저 등록하세요.</p>
      )}
      <div className="space-y-3">
        {workloads.map((w) => {
          const res = project.resources.find((r) => r.id === w.resourceId)!;
          const capacityPerWeek = res.capacityHoursPerDay * 5;
          return (
            <div key={w.resourceId} className="rounded-lg border border-border bg-surface-2 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ background: res.color }} />
                  <span className="text-sm font-medium text-content">{res.name}</span>
                  <span className="text-2xs text-content-muted">{res.role}</span>
                </div>
                <div className="flex items-center gap-3 text-2xs text-content-muted">
                  <span>총 {Math.round(w.totalHours)}h</span>
                  <span>피크 {Math.round(w.peakDailyHours)}h/일</span>
                  {w.overloadedDays > 0 && (
                    <span className="flex items-center gap-1 text-critical">
                      <AlertTriangle size={12} /> 과부하 {w.overloadedDays}일
                    </span>
                  )}
                </div>
              </div>
              <div className="flex h-20 items-end gap-0.5 overflow-x-auto">
                {w.weeks.map((wk) => {
                  const heightPct = (wk.hours / maxWeekly) * 100;
                  const over = wk.overloadedDays > 0;
                  return (
                    <div
                      key={wk.weekStart}
                      className="group relative flex w-3 shrink-0 flex-col justify-end"
                      title={`${wk.weekStart} · ${Math.round(wk.hours)}h${over ? ` · 과부하 ${wk.overloadedDays}일` : ''}`}
                    >
                      <div
                        className={over ? 'bg-critical' : 'bg-accent'}
                        style={{ height: `${Math.max(2, heightPct)}%`, borderRadius: '2px 2px 0 0' }}
                      />
                    </div>
                  );
                })}
                {w.weeks.length === 0 && (
                  <span className="text-2xs text-content-muted">할당된 작업 없음</span>
                )}
              </div>
              <div className="mt-1 text-2xs text-content-muted">주당 capacity ≈ {capacityPerWeek}h</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
