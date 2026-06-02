import { AlertTriangle, CircleCheck } from 'lucide-react';
import { useProjectStore } from '@/app/store/useProjectStore';

/** Bottom status bar: project metrics, critical-path summary and warnings. */
export function StatusBar() {
  const derived = useProjectStore((s) => s.derived);
  const selectedCount = useProjectStore((s) => s.selectedTaskIds.size);
  const dirty = useProjectStore((s) => s.dirty);
  const project = derived.project;

  const taskCount = project.tasks.length;
  const criticalCount = derived.criticalPath.length;
  const cyclic = derived.cyclicTaskIds.length;

  const fmt = (iso?: string) => (iso ? iso.slice(0, 10) : '—');

  return (
    <div className="flex items-center gap-4 border-t border-border bg-surface-2 px-3 py-1 text-2xs text-content-muted">
      <span>작업 {taskCount.toLocaleString()}개</span>
      <span>의존성 {project.dependencies.length.toLocaleString()}개</span>
      <span>크리티컬 {criticalCount}개</span>
      <span>기간 {derived.projectDuration}일</span>
      {derived.projectFinish && <span>완료 예상 {derived.projectFinish}</span>}
      {selectedCount > 0 && <span className="text-accent">선택 {selectedCount}개</span>}

      <div className="ml-auto flex items-center gap-3">
        <span title="프로젝트 생성일">생성 {fmt(project.createdAt)}</span>
        <span title="마지막 저장 시각">저장 {fmt(project.updatedAt)}</span>
        {cyclic > 0 ? (
          <span className="flex items-center gap-1 text-critical">
            <AlertTriangle size={12} /> 순환 의존성 {cyclic}개
          </span>
        ) : (
          <span className="flex items-center gap-1 text-emerald-500">
            <CircleCheck size={12} /> 정상
          </span>
        )}
        <span>{dirty ? '저장되지 않음' : '저장됨'}</span>
      </div>
    </div>
  );
}
