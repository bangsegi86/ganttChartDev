import { useState } from 'react';
import { Trash2, Eye, EyeOff } from 'lucide-react';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui/Button';
import { useProjectStore } from '@/app/store/useProjectStore';
import { diffDaysISO } from '@/shared/date/dateUtils';

/**
 * Capture and compare baselines. Shows schedule variance (계획 vs 실제) of the
 * active baseline against the current plan.
 */
export function BaselineManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useProjectStore((s) => s.derived.project);
  const showBaseline = useProjectStore((s) => s.view.showBaseline);
  const capture = useProjectStore((s) => s.captureBaseline);
  const setActive = useProjectStore((s) => s.setActiveBaseline);
  const remove = useProjectStore((s) => s.removeBaseline);
  const toggleBaseline = useProjectStore((s) => s.toggleBaseline);

  const [name, setName] = useState('');

  const active = project.baselines.find((b) => b.id === project.activeBaselineId) ?? null;

  // Aggregate finish-date variance across all tasks vs the active baseline.
  const variance = (() => {
    if (!active) return null;
    let totalSlip = 0;
    let slipped = 0;
    for (const entry of active.entries) {
      const task = project.tasks.find((t) => t.id === entry.taskId);
      if (!task) continue;
      const delta = diffDaysISO(entry.end, task.end);
      if (delta !== 0) slipped++;
      totalSlip += delta;
    }
    return { totalSlip, slipped, count: active.entries.length };
  })();

  return (
    <Modal open={open} onClose={onClose} title="베이스라인" width={520}>
      <div className="mb-3 flex items-end gap-2">
        <label className="flex flex-1 flex-col text-2xs text-content-muted">
          베이스라인 이름
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 초기 계획"
            className="mt-0.5 h-8 rounded border border-border bg-surface px-2 text-xs text-content outline-none transition-colors focus:border-accent"
          />
        </label>
        <Button
          size="sm"
          variant="accent"
          onClick={() => {
            capture(name.trim() || `베이스라인 ${project.baselines.length + 1}`);
            setName('');
          }}
        >
          현재 계획 저장
        </Button>
        <Button size="sm" active={showBaseline} onClick={toggleBaseline}>
          {showBaseline ? <Eye size={14} /> : <EyeOff size={14} />} 오버레이
        </Button>
      </div>

      {variance && (
        <div className="mb-3 grid grid-cols-3 gap-2 rounded border border-border bg-surface-2 p-3 text-center text-xs">
          <Metric label="전체 편차" value={`${variance.totalSlip > 0 ? '+' : ''}${variance.totalSlip}일`} />
          <Metric label="지연 작업" value={`${variance.slipped}개`} />
          <Metric
            label="지연률"
            value={`${variance.count ? Math.round((variance.slipped / variance.count) * 100) : 0}%`}
          />
        </div>
      )}

      <div className="max-h-60 overflow-auto rounded border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface-2 text-content-muted">
            <tr>
              <th className="p-2 text-left">이름</th>
              <th className="p-2 text-left">저장 시각</th>
              <th className="p-2 text-center">활성</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {project.baselines.map((b) => (
              <tr key={b.id} className="border-t border-border transition-colors hover:bg-surface-2/60">
                <td className="p-2 text-content">{b.name}</td>
                <td className="p-2 text-content-muted">{new Date(b.capturedAt).toLocaleString('ko-KR')}</td>
                <td className="p-2 text-center">
                  <input
                    type="radio"
                    checked={project.activeBaselineId === b.id}
                    onChange={() => setActive(b.id)}
                    aria-label="활성 베이스라인"
                  />
                </td>
                <td className="p-2 text-right">
                  <button onClick={() => remove(b.id)} aria-label="삭제" className="text-content-muted hover:text-critical">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {project.baselines.length === 0 && (
              <tr>
                <td colSpan={4} className="p-4 text-center text-content-muted">
                  저장된 베이스라인이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-base font-semibold text-content">{value}</div>
      <div className="text-2xs text-content-muted">{label}</div>
    </div>
  );
}
