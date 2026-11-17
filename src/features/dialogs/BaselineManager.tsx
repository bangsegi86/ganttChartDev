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
    <Modal open={open} onClose={onClose} title="계획 비교 (베이스라인)" width={520}>
      <p className="mb-3 rounded-md bg-surface px-3 py-2 text-2xs leading-relaxed text-content-muted">
        지금 일정을 이름을 붙여 &lsquo;기준 계획&rsquo;으로 저장해 두세요. 나중에 그 기준 계획을 고르고 &lsquo;차트에 표시&rsquo;를 켜면, 막대 아래에 원래 계획이 회색 줄로 나타나 얼마나 밀렸는지 비교할 수 있습니다.
      </p>
      <div className="mb-3 flex items-end gap-2">
        <label className="flex flex-1 flex-col text-2xs text-content-muted">
          기준 계획 이름
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
            capture(name.trim() || `기준 계획 ${project.baselines.length + 1}`);
            setName('');
          }}
        >
          지금 일정을 기준 계획으로 저장
        </Button>
        <Button size="sm" active={showBaseline} onClick={toggleBaseline}
          tip="차트에 표시 (켜기/끄기)" tipDesc="선택한 기준 계획을 막대 아래 회색 줄로 겹쳐 보여 줍니다.">
          {showBaseline ? <Eye size={14} /> : <EyeOff size={14} />} 차트에 표시
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
              <th className="p-2 text-center">비교에 사용</th>
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
                    aria-label="이 기준 계획과 비교"
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
                  아직 저장한 기준 계획이 없습니다. 위에서 이름을 넣고 저장해 보세요.
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
