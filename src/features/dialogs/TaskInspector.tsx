import { Modal } from '@/shared/ui/Modal';
import { useProjectStore } from '@/app/store/useProjectStore';
import type { ConstraintType, Priority } from '@/entities';

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'low', label: '낮음' },
  { value: 'medium', label: '보통' },
  { value: 'high', label: '높음' },
  { value: 'critical', label: '긴급' },
];

const CONSTRAINTS: { value: ConstraintType; label: string }[] = [
  { value: 'asap', label: '가능한 빨리 (ASAP)' },
  { value: 'snet', label: '이 날짜 이후 시작 (SNET)' },
  { value: 'mso', label: '반드시 이 날 시작 (MSO)' },
  { value: 'mfo', label: '반드시 이 날 종료 (MFO)' },
];

/** Full task editor for fields not surfaced in the grid. */
export function TaskInspector() {
  const inspectingTaskId = useProjectStore((s) => s.inspectingTaskId);
  const task = useProjectStore((s) =>
    s.derived.project.tasks.find((t) => t.id === s.inspectingTaskId),
  );
  const resources = useProjectStore((s) => s.derived.project.resources);
  const schedule = useProjectStore((s) =>
    s.inspectingTaskId ? s.derived.schedules.get(s.inspectingTaskId) : undefined,
  );
  const updateTask = useProjectStore((s) => s.updateTask);
  const setInspecting = useProjectStore((s) => s.setInspecting);

  if (!inspectingTaskId || !task) return null;

  const toggleAssignee = (id: string) => {
    const set = new Set(task.assigneeIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    updateTask(task.id, { assigneeIds: [...set] });
  };

  return (
    <Modal open title="작업 상세" width={520} onClose={() => setInspecting(null)}>
      <div className="space-y-4 text-sm text-content">
        <Field label="작업명">
          <input
            value={task.name}
            onChange={(e) => updateTask(task.id, { name: e.target.value })}
            className="input"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="시작일">
            <input
              type="date"
              value={task.start}
              onChange={(e) => updateTask(task.id, { start: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="종료일">
            <input
              type="date"
              value={task.end}
              onChange={(e) => updateTask(task.id, { end: e.target.value })}
              className="input"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={`진척률 (${task.progress}%)`}>
            <input
              type="range"
              min={0}
              max={100}
              value={task.progress}
              onChange={(e) => updateTask(task.id, { progress: Number(e.target.value) })}
              className="w-full accent-[rgb(var(--color-accent))]"
            />
          </Field>
          <Field label="우선순위">
            <select
              value={task.priority}
              onChange={(e) => updateTask(task.id, { priority: e.target.value as Priority })}
              className="input"
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="막대 색상">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={task.color ?? '#3b82f6'}
              onChange={(e) => updateTask(task.id, { color: e.target.value })}
              className="h-8 w-12 cursor-pointer rounded border border-border bg-transparent p-0.5"
              aria-label="막대 색상 선택"
            />
            {task.color && (
              <button
                onClick={() => updateTask(task.id, { color: null })}
                className="rounded border border-border px-2 py-1 text-2xs text-content-muted hover:bg-surface-2"
                title="기본 색상 사용"
              >
                기본값으로
              </button>
            )}
            <span className="text-2xs text-content-muted">
              {task.color ? task.color : '기본값 (우선순위/그룹 색상)'}
            </span>
          </div>
        </Field>

        <Field label="제약 조건">
          <div className="flex gap-2">
            <select
              value={task.constraint}
              onChange={(e) => updateTask(task.id, { constraint: e.target.value as ConstraintType })}
              className="input flex-1"
            >
              {CONSTRAINTS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            {task.constraint !== 'asap' && (
              <input
                type="date"
                value={task.constraintDate ?? ''}
                onChange={(e) => updateTask(task.id, { constraintDate: e.target.value || null })}
                className="input"
              />
            )}
          </div>
        </Field>

        <Field label="담당자">
          <div className="flex flex-wrap gap-2">
            {resources.map((r) => (
              <label
                key={r.id}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-1 text-2xs ${
                  task.assigneeIds.includes(r.id)
                    ? 'border-accent bg-accent/15 text-content'
                    : 'border-border text-content-muted'
                }`}
              >
                <input
                  type="checkbox"
                  checked={task.assigneeIds.includes(r.id)}
                  onChange={() => toggleAssignee(r.id)}
                  className="hidden"
                />
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />
                {r.name}
              </label>
            ))}
            {resources.length === 0 && <span className="text-2xs text-content-muted">담당자가 없습니다.</span>}
          </div>
        </Field>

        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={task.isMilestone}
              onChange={(e) => updateTask(task.id, { isMilestone: e.target.checked })}
              className="h-4 w-4 accent-[rgb(var(--color-accent))]"
            />
            마일스톤
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={task.manuallyScheduled}
              onChange={(e) => updateTask(task.id, { manuallyScheduled: e.target.checked })}
              className="h-4 w-4 accent-[rgb(var(--color-accent))]"
            />
            수동 일정
          </label>
        </div>

        <Field label="메모">
          <textarea
            value={task.notes}
            onChange={(e) => updateTask(task.id, { notes: e.target.value })}
            rows={3}
            className="input resize-none"
          />
        </Field>

        {schedule && (
          <div className="grid grid-cols-3 gap-2 rounded border border-border bg-surface-2 p-2 text-center text-2xs text-content-muted">
            <div>
              <div className="text-sm text-content">{schedule.totalFloat}일</div>
              전체 여유
            </div>
            <div>
              <div className="text-sm text-content">{schedule.freeFloat}일</div>
              독립 여유
            </div>
            <div>
              <div className={`text-sm ${schedule.isCritical ? 'text-critical' : 'text-content'}`}>
                {schedule.isCritical ? '예' : '아니오'}
              </div>
              크리티컬 경로
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-2xs font-semibold text-content-muted">{label}</span>
      {children}
    </label>
  );
}
