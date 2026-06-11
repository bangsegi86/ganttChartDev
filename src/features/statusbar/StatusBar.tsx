import { AlertTriangle, CircleCheck, Clock } from 'lucide-react';
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
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-4 border-t border-border bg-surface-2 px-3 py-1 text-2xs text-content-muted shrink-0"
    >
      <span title="전체 작업 수">작업 {taskCount.toLocaleString()}개</span>
      <span title="의존성 수">의존성 {project.dependencies.length.toLocaleString()}개</span>
      {criticalCount > 0 && (
        <span title="크리티컬 패스 작업 수" className="text-critical/80">크리티컬 {criticalCount}개</span>
      )}
      <span title="전체 프로젝트 기간">기간 {derived.projectDuration}일</span>
      {derived.projectFinish && (
        <span title="예상 완료일" className="flex items-center gap-1">
          <Clock size={11} /> {derived.projectFinish}
        </span>
      )}
      {selectedCount > 0 && (
        <span className="rounded bg-accent/10 px-1.5 py-0.5 font-medium text-accent">
          {selectedCount}개 선택
        </span>
      )}

      <div className="ml-auto flex items-center gap-3">
        <span title={`마지막 저장: ${fmt(project.updatedAt)}`}>저장 {fmt(project.updatedAt)}</span>
        {cyclic > 0 ? (
          <span
            className="flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-critical bg-critical/10 border border-critical/30"
            title="순환 의존성이 있으면 일정 계산이 올바르지 않을 수 있습니다."
          >
            <AlertTriangle size={11} /> 순환 의존성 {cyclic}개
          </span>
        ) : (
          <span className="flex items-center gap-1 text-success" title="일정 계산 정상">
            <CircleCheck size={11} /> 정상
          </span>
        )}
        <span className={`font-medium ${dirty ? 'text-amber-400' : 'text-success'}`}>
          {dirty ? '● 미저장' : '저장됨'}
        </span>
      </div>
    </div>
  );
}
