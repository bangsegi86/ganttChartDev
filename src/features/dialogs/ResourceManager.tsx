import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { nanoid } from 'nanoid';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui/Button';
import { useProjectStore } from '@/app/store/useProjectStore';

const SWATCHES = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4', '#8b5cf6'];

/** CRUD for project resources (담당자). */
export function ResourceManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const resources = useProjectStore((s) => s.derived.project.resources);
  const upsert = useProjectStore((s) => s.upsertResource);
  const remove = useProjectStore((s) => s.removeResource);

  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [color, setColor] = useState(SWATCHES[0]!);
  const [capacity, setCapacity] = useState(8);

  const add = () => {
    if (!name.trim()) return;
    upsert({ id: nanoid(8), name: name.trim(), role: role.trim(), color, capacityHoursPerDay: capacity });
    setName('');
    setRole('');
  };

  return (
    <Modal open={open} onClose={onClose} title="담당자 관리" width={560}>
      <div className="mb-3 space-y-2">
        {/* Row 1: text fields */}
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col text-2xs text-content-muted">
            이름
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
              className="mt-0.5 h-8 rounded border border-border bg-surface px-2 text-xs text-content outline-none transition-colors focus:border-accent"
            />
          </label>
          <label className="flex flex-col text-2xs text-content-muted">
            역할
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-0.5 h-8 w-28 rounded border border-border bg-surface px-2 text-xs text-content outline-none transition-colors focus:border-accent"
            />
          </label>
          <label className="flex flex-col text-2xs text-content-muted">
            시간/일
            <input
              type="number"
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
              className="mt-0.5 h-8 w-16 rounded border border-border bg-surface px-2 text-xs text-content outline-none transition-colors focus:border-accent"
            />
          </label>
        </div>
        {/* Row 2: colour swatches + add button */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col text-2xs text-content-muted">
            색상
            <div className="mt-1 flex gap-1.5">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="h-6 w-6 rounded-full transition-transform hover:scale-110"
                  style={{
                    background: c,
                    outline: color === c ? '2px solid rgb(var(--color-accent))' : '2px solid transparent',
                    outlineOffset: '2px',
                  }}
                  aria-label={`색상 ${c}`}
                  aria-pressed={color === c}
                />
              ))}
            </div>
          </div>
          <Button size="sm" variant="accent" onClick={add}>
            추가
          </Button>
        </div>
      </div>

      <div className="max-h-72 overflow-auto rounded border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface-2 text-content-muted">
            <tr>
              <th className="p-2 text-left">이름</th>
              <th className="p-2 text-left">역할</th>
              <th className="p-2 text-right">시간/일</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {resources.map((r) => (
              <tr key={r.id} className="border-t border-border transition-colors hover:bg-surface-2/60">
                <td className="p-2">
                  <span className="inline-flex items-center gap-2 text-content">
                    <span className="h-3 w-3 rounded-full" style={{ background: r.color }} />
                    {r.name}
                  </span>
                </td>
                <td className="p-2 text-content-muted">{r.role || '—'}</td>
                <td className="p-2 text-right text-content">{r.capacityHoursPerDay}h</td>
                <td className="p-2 text-right">
                  <button onClick={() => remove(r.id)} aria-label="삭제" className="text-content-muted hover:text-critical">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {resources.length === 0 && (
              <tr>
                <td colSpan={4} className="p-4 text-center text-content-muted">
                  등록된 담당자가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
