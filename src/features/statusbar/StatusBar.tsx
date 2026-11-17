import { tipProps } from '@/shared/ui/Tooltip';
import { AlertTriangle, CircleCheck, Clock } from 'lucide-react';
import { useProjectStore } from '@/app/store/useProjectStore';

/** Bottom status bar: project metrics, critical-path summary and warnings. */
export function StatusBar() {
  const derived = useProjectStore((s) => s.derived);
  const selectedCount = useProjectStore((s) => s.selectedTaskIds.size);
  const project = derived.project;

  const taskCount = project.tasks.length;
  const criticalCount = derived.criticalPath.length;
  const cyclic = derived.cyclicTaskIds.length;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-4 border-t border-border bg-surface-2 px-3 py-1 text-2xs text-content-muted shrink-0"
    >
      <span title="전체 작업 수">작업 {taskCount.toLocaleString()}개</span>
      <span {...tipProps('연결 수', '작업끼리 이어진 선(의존성)의 개수입니다.')}>연결 {project.dependencies.length.toLocaleString()}개</span>
      {criticalCount > 0 && (
        <span {...tipProps('크리티컬 패스 작업', '하루만 늦어져도 완료일이 늦어지는 작업 수입니다.')} className="text-critical/80">크리티컬 {criticalCount}개</span>
      )}
      <span {...tipProps('전체 기간', '첫 작업 시작부터 마지막 작업 끝까지의 근무일 수입니다.')}>기간 {derived.projectDuration}일</span>
      {derived.projectFinish && (
        <span {...tipProps('예상 완료일', '지금 일정대로라면 프로젝트가 끝나는 날입니다.')} className="flex items-center gap-1">
          <Clock size={11} /> {derived.projectFinish}
        </span>
      )}
      {selectedCount > 0 && (
        <span className="rounded bg-accent/10 px-1.5 py-0.5 font-medium text-accent">
          {selectedCount}개 선택
        </span>
      )}

      <div className="ml-auto flex items-center gap-3">
        {cyclic > 0 ? (
          <span
            className="flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-critical bg-critical/10 border border-critical/30"
            {...tipProps('연결이 돌고 있습니다', 'A→B→A처럼 서로를 기다리는 연결이 있어 일정을 계산할 수 없습니다. 연결선을 클릭해 Delete로 하나를 지우세요.')}
          >
            <AlertTriangle size={11} /> 서로 기다리는 연결 {cyclic}개
          </span>
        ) : (
          <span className="flex items-center gap-1 text-success" {...tipProps('일정 계산 정상', '연결에 문제가 없습니다.')}>
            <CircleCheck size={11} /> 일정 계산 정상
          </span>
        )}
      </div>
    </div>
  );
}
