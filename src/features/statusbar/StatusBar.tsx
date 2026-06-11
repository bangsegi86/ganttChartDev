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
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-4 border-t border-border bg-surface-2 px-3 py-1 text-2xs text-content-muted"
    >
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
          <span
            className="flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-critical bg-critical/10 border border-critical/30"
            title="순환 의존성이 있으면 일정 계산이 올바르지 않을 수 있습니다. 의존성 탭에서 확인하세요."
          >
            <AlertTriangle size={12} /> 순환 의존성 {cyclic}개
          </span>
        ) : (
          <span className="flex items-center gap-1 text-success">
            <CircleCheck size={12} /> 정상
          </span>
        )}
        <span className={dirty ? 'text-amber-400' : ''}>{dirty ? '● 저장되지 않음' : '저장됨'}</span>
      </div>
    </div>
  );
}
