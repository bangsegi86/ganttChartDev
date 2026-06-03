import { Layers, UserCheck, X } from 'lucide-react';
import { useProjectStore } from '@/app/store/useProjectStore';

/**
 * Thin banner shown whenever a non-`all` view filter is active, making it
 * obvious that the grid/gantt are showing a subset and offering a one-click
 * return to the full plan.
 */
export function ViewFilterBanner({ onManageGroups }: { onManageGroups: () => void }) {
  const mode = useProjectStore((s) => s.view.filterMode);
  const groupId = useProjectStore((s) => s.view.filterGroupId);
  const focusCount = useProjectStore((s) => s.view.focusIds.length);
  const filterAssigneeIds = useProjectStore((s) => s.view.filterAssigneeIds);
  const groups = useProjectStore((s) => s.derived.project.viewGroups);
  const resources = useProjectStore((s) => s.derived.project.resources);
  const clearViewFilter = useProjectStore((s) => s.clearViewFilter);

  if (mode === 'all') return null;

  const group = mode === 'group' ? groups.find((g) => g.id === groupId) : null;

  let icon = <Layers size={13} className="shrink-0 text-accent" />;
  let label = '';

  if (mode === 'group') {
    label = group ? `보기 그룹: ${group.name} (${group.taskIds.length}개)` : '보기 그룹';
  } else if (mode === 'focus') {
    label = `선택한 ${focusCount}개 작업만 표시 중`;
  } else if (mode === 'assignee') {
    icon = <UserCheck size={13} className="shrink-0 text-accent" />;
    const names = filterAssigneeIds
      .map((id) => resources.find((r) => r.id === id)?.name)
      .filter(Boolean)
      .join(', ');
    label = `담당자 필터: ${names || `${filterAssigneeIds.length}명`}`;
  }

  return (
    <div className="flex items-center gap-3 border-b border-accent/40 bg-accent/10 px-3 py-1.5 text-xs text-content">
      {group && (
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: group.color }} />
      )}
      {icon}
      <span className="font-medium">{label}</span>
      {mode === 'group' && (
        <button
          onClick={onManageGroups}
          className="rounded border border-border px-2 py-0.5 text-2xs text-content-muted hover:bg-surface-2"
        >
          그룹 관리
        </button>
      )}
      <button
        onClick={clearViewFilter}
        className="ml-auto flex items-center gap-1 rounded border border-border px-2 py-0.5 text-2xs text-content hover:bg-surface-2"
      >
        <X size={12} /> 전체 보기
      </button>
    </div>
  );
}
