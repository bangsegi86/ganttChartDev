import { Modal } from '@/shared/ui/Modal';
import { useProjectStore } from '@/app/store/useProjectStore';
import { useState, useEffect, useRef } from 'react';
import type { ConstraintType, Priority } from '@/entities';
import { addDaysISO } from '@/shared/date/dateUtils';
import { CalendarDays } from 'lucide-react';

const PRIORITIES: { value: Priority; label: string; color: string }[] = [
  { value: 'low',      label: '낮음', color: 'bg-surface-3 text-content-muted' },
  { value: 'medium',   label: '보통', color: 'bg-blue-500/20 text-blue-400' },
  { value: 'high',     label: '높음', color: 'bg-amber-500/20 text-amber-500' },
  { value: 'critical', label: '긴급', color: 'bg-critical/20 text-critical' },
];

const CONSTRAINTS: { value: ConstraintType; label: string }[] = [
  { value: 'asap', label: '가능한 빨리 (ASAP)' },
  { value: 'snet', label: '이 날짜 이후 시작 (SNET)' },
  { value: 'mso',  label: '반드시 이 날 시작 (MSO)' },
  { value: 'mfo',  label: '반드시 이 날 종료 (MFO)' },
];

/** Normalise any common date string to YYYY-MM-DD, or return null. */
function normalizeDate(raw: string): string | null {
  const s = raw.trim().replace(/[./]/g, '-');               // . and / → -
  const compact = s.replace(/-/g, '');                       // strip hyphens for digit-only check
  if (/^\d{8}$/.test(compact)) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

/** Full task editor for fields not surfaced in the grid. */
export function TaskInspector() {
  const inspectingTaskId = useProjectStore((s) => s.inspectingTaskId);
  const task = useProjectStore((s) =>
    s.derived.project.tasks.find((t) => t.id === s.inspectingTaskId),
  );
  const resources  = useProjectStore((s) => s.derived.project.resources);
  const schedule   = useProjectStore((s) =>
    s.inspectingTaskId ? s.derived.schedules.get(s.inspectingTaskId) : undefined,
  );
  const updateTask  = useProjectStore((s) => s.updateTask);
  const setInspecting = useProjectStore((s) => s.setInspecting);

  const [startDraft, setStartDraft] = useState(task?.start ?? '');
  const [endDraft,   setEndDraft]   = useState(task?.end   ?? '');

  const startPickerRef = useRef<HTMLInputElement>(null);
  const endPickerRef   = useRef<HTMLInputElement>(null);

  useEffect(() => { if (task) setStartDraft(task.start); }, [task?.start]);
  useEffect(() => { if (task) setEndDraft(task.end);   }, [task?.end]);

  if (!inspectingTaskId || !task) return null;

  const commitDate = (field: 'start' | 'end', raw: string) => {
    const normalized = normalizeDate(raw);
    if (!normalized) {
      if (field === 'start') setStartDraft(task.start);
      else setEndDraft(task.end);
      return;
    }

    if (field === 'start') {
      if (normalized >= task.end) {
        // Auto-advance end to start + 1 day
        const newEnd = addDaysISO(normalized, 1);
        updateTask(task.id, { start: normalized, end: newEnd });
        setEndDraft(newEnd);
      } else {
        updateTask(task.id, { start: normalized });
      }
    } else {
      updateTask(task.id, { end: normalized });
    }
  };

  const toggleAssignee = (id: string) => {
    const set = new Set(task.assigneeIds);
    if (set.has(id)) set.delete(id); else set.add(id);
    updateTask(task.id, { assigneeIds: [...set] });
  };

  return (
    <Modal open title="작업 상세" width={540} onClose={() => setInspecting(null)}>
      <div className="space-y-4 text-sm text-content">

        {/* 작업명 */}
        <Field label="작업명">
          <input
            value={task.name}
            onChange={(e) => updateTask(task.id, { name: e.target.value })}
            className="input"
          />
        </Field>

        {/* 날짜 */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="시작일">
            <div className="flex items-center gap-1">
              <input
                type="text"
                placeholder="YYYY-MM-DD"
                inputMode="numeric"
                value={startDraft}
                onChange={(e) => setStartDraft(e.target.value)}
                onBlur={(e) => commitDate('start', e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitDate('start', startDraft); }}
                className="input flex-1 min-w-0"
              />
              {/* hidden native date picker */}
              <input
                ref={startPickerRef}
                type="date"
                tabIndex={-1}
                className="sr-only"
                value={startDraft}
                onChange={(e) => {
                  if (!e.target.value) return;
                  setStartDraft(e.target.value);
                  commitDate('start', e.target.value);
                }}
              />
              <button
                type="button"
                title="달력에서 선택"
                onClick={() => startPickerRef.current?.showPicker?.()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-surface-2 text-content-muted hover:bg-surface-3 hover:text-content"
              >
                <CalendarDays size={14} />
              </button>
            </div>
          </Field>
          <Field label="종료일">
            <div className="flex items-center gap-1">
              <input
                type="text"
                placeholder="YYYY-MM-DD"
                inputMode="numeric"
                value={endDraft}
                onChange={(e) => setEndDraft(e.target.value)}
                onBlur={(e) => commitDate('end', e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitDate('end', endDraft); }}
                className="input flex-1 min-w-0"
              />
              <input
                ref={endPickerRef}
                type="date"
                tabIndex={-1}
                className="sr-only"
                value={endDraft}
                onChange={(e) => {
                  if (!e.target.value) return;
                  setEndDraft(e.target.value);
                  commitDate('end', e.target.value);
                }}
              />
              <button
                type="button"
                title="달력에서 선택"
                onClick={() => endPickerRef.current?.showPicker?.()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-surface-2 text-content-muted hover:bg-surface-3 hover:text-content"
              >
                <CalendarDays size={14} />
              </button>
            </div>
          </Field>
        </div>

        {/* 진척률 */}
        <Field label={`진척률 — ${task.progress}%`}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={task.progress}
              onChange={(e) => updateTask(task.id, { progress: Number(e.target.value) })}
              className="flex-1 accent-[rgb(var(--color-accent))]"
            />
            <input
              type="number"
              min={0}
              max={100}
              value={task.progress}
              onChange={(e) => {
                const v = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
                updateTask(task.id, { progress: v });
              }}
              className="input w-16 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
        </Field>

        {/* 우선순위 라디오 */}
        <Field label="우선순위">
          <div className="flex gap-2">
            {PRIORITIES.map((p) => (
              <label
                key={p.value}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-2xs font-medium transition-all ${
                  task.priority === p.value
                    ? `${p.color} border-current`
                    : 'border-border text-content-muted hover:border-border/80 hover:text-content'
                }`}
              >
                <input
                  type="radio"
                  name={`priority-${task.id}`}
                  value={p.value}
                  checked={task.priority === p.value}
                  onChange={() => updateTask(task.id, { priority: p.value as Priority })}
                  className="hidden"
                />
                {task.priority === p.value && (
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                )}
                {p.label}
              </label>
            ))}
          </div>
        </Field>

        {/* 막대 색상 */}
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

        {/* 제약 조건 */}
        <Field label="제약 조건">
          <div className="flex gap-2">
            <select
              value={task.constraint}
              onChange={(e) => updateTask(task.id, { constraint: e.target.value as ConstraintType })}
              className="input flex-1"
            >
              {CONSTRAINTS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            {task.constraint !== 'asap' && (
              <input
                type="text"
                placeholder="YYYY-MM-DD"
                inputMode="numeric"
                value={task.constraintDate ?? ''}
                onChange={(e) => updateTask(task.id, { constraintDate: e.target.value || null })}
                className="input"
              />
            )}
          </div>
        </Field>

        {/* 담당자 */}
        <Field label="담당자">
          <div className="flex flex-wrap gap-2">
            {resources.map((r) => (
              <label
                key={r.id}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-1 text-2xs transition-all hover:border-accent/50 ${
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
            {resources.length === 0 && (
              <span className="text-2xs text-content-muted">담당자가 없습니다.</span>
            )}
          </div>
        </Field>

        {/* 체크박스들 */}
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
          <label
            className="flex items-center gap-2 text-xs"
            title="체크 시 의존성 무시하고 날짜 고정 / 해제 시 의존성에 따라 자동 이동"
          >
            <input
              type="checkbox"
              checked={task.manuallyScheduled}
              onChange={(e) => {
                if (e.target.checked) {
                  updateTask(task.id, { manuallyScheduled: true });
                } else {
                  updateTask(task.id, {
                    manuallyScheduled: false,
                    constraint: 'asap',
                    constraintDate: null,
                  });
                }
              }}
              className="h-4 w-4 accent-[rgb(var(--color-accent))]"
            />
            수동 고정 <span className="text-content-muted">(의존성 무시)</span>
          </label>
        </div>

        {/* 메모 — 최소 5줄, 길면 스크롤 */}
        <Field label="메모">
          <textarea
            value={task.notes}
            onChange={(e) => updateTask(task.id, { notes: e.target.value })}
            rows={5}
            placeholder="메모를 입력하면 차트 막대 위에 마우스를 올렸을 때 표시됩니다."
            className="input min-h-[7rem] max-h-48 resize-y overflow-y-auto"
          />
        </Field>

        {/* 스케줄 계산 정보 */}
        {schedule && (
          <div className="rounded border border-border bg-surface-2 p-3">
            <div className="mb-2 text-2xs font-semibold uppercase tracking-wider text-content-muted">일정 계산 결과</div>
            <div className="grid grid-cols-3 gap-2 text-center text-2xs">
              <div title="이 작업이 지연될 수 있는 최대 일수 (전체 프로젝트 지연 없이)">
                <div className={`mb-0.5 text-sm font-semibold ${schedule.totalFloat === 0 ? 'text-critical' : 'text-content'}`}>
                  {schedule.totalFloat}일
                </div>
                <div className="text-content-muted">전체 여유</div>
              </div>
              <div title="후속 작업에 영향 없이 지연할 수 있는 최대 일수">
                <div className={`mb-0.5 text-sm font-semibold ${schedule.freeFloat === 0 ? 'text-amber-400' : 'text-content'}`}>
                  {schedule.freeFloat}일
                </div>
                <div className="text-content-muted">독립 여유</div>
              </div>
              <div title="크리티컬 패스: 이 작업이 지연되면 전체 프로젝트가 지연됩니다">
                <div className={`mb-0.5 text-sm font-semibold ${schedule.isCritical ? 'text-critical' : 'text-success'}`}>
                  {schedule.isCritical ? '위험' : '안전'}
                </div>
                <div className="text-content-muted">크리티컬</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium text-content-muted">{label}</span>
      {children}
    </div>
  );
}
