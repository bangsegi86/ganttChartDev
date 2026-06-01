import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui/Button';
import { useProjectStore } from '@/app/store/useProjectStore';

const PRESET_COLORS = [
  '#e11d48', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#6366f1', '#a855f7', '#ec4899',
];

export function MarkerManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const markers = useProjectStore((s) => s.derived.project.markers ?? []);
  const addMarker = useProjectStore((s) => s.addMarker);
  const updateMarker = useProjectStore((s) => s.updateMarker);
  const removeMarker = useProjectStore((s) => s.removeMarker);

  const [date, setDate] = useState('');
  const [label, setLabel] = useState('');
  const [color, setColor] = useState('#e11d48');
  const [editingId, setEditingId] = useState<string | null>(null);

  const reset = () => {
    setDate(''); setLabel(''); setColor('#e11d48'); setEditingId(null);
  };

  const commit = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !label.trim()) return;
    if (editingId) {
      updateMarker(editingId, { date, label: label.trim(), color });
    } else {
      addMarker({ date, label: label.trim(), color });
    }
    reset();
  };

  const startEdit = (id: string) => {
    const m = markers.find((x) => x.id === id);
    if (!m) return;
    setEditingId(id);
    setDate(m.date);
    setLabel(m.label);
    setColor(m.color);
  };

  return (
    <Modal open={open} onClose={onClose} title="차트 마커 관리" width={540}>
      {/* Input row */}
      <div className="mb-3 flex items-end gap-2">
        <label className="flex flex-col text-2xs text-content-muted">
          날짜
          <input
            type="text"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            placeholder="YYYY-MM-DD"
            inputMode="numeric"
            className="mt-0.5 h-8 w-32 rounded border border-border bg-surface px-2 text-xs text-content"
          />
        </label>
        <label className="flex flex-1 flex-col text-2xs text-content-muted">
          이름
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
            placeholder="예: 오픈일"
            className="mt-0.5 h-8 rounded border border-border bg-surface px-2 text-xs text-content"
          />
        </label>
        <label className="flex flex-col text-2xs text-content-muted">
          색상
          <div className="mt-0.5 flex items-center gap-1">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-8 w-8 cursor-pointer rounded border border-border bg-transparent p-0.5"
            />
          </div>
        </label>
        <Button size="sm" variant="accent" onClick={commit}>
          {editingId ? '수정' : '추가'}
        </Button>
        {editingId && (
          <Button size="sm" onClick={reset}>
            취소
          </Button>
        )}
      </div>

      {/* Preset color swatches */}
      <div className="mb-3 flex items-center gap-1.5">
        <span className="text-2xs text-content-muted">빠른 색상:</span>
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110"
            style={{
              background: c,
              borderColor: color === c ? 'white' : 'transparent',
              outline: color === c ? `2px solid ${c}` : 'none',
            }}
            onClick={() => setColor(c)}
            title={c}
          />
        ))}
      </div>

      {/* Marker list */}
      <div className="max-h-72 overflow-auto rounded border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface-2 text-content-muted">
            <tr>
              <th className="p-2 text-left">색상</th>
              <th className="p-2 text-left">날짜</th>
              <th className="p-2 text-left">이름</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {markers.map((m) => (
              <tr
                key={m.id}
                className={`border-t border-border ${editingId === m.id ? 'bg-accent/10' : ''}`}
              >
                <td className="p-2">
                  <span
                    className="inline-block h-3 w-8 rounded"
                    style={{ background: m.color }}
                  />
                </td>
                <td className="p-2 text-content">{m.date}</td>
                <td className="p-2 font-medium text-content">{m.label}</td>
                <td className="p-2 text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => startEdit(m.id)}
                      aria-label="편집"
                      className="text-content-muted hover:text-content"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => { removeMarker(m.id); if (editingId === m.id) reset(); }}
                      aria-label="삭제"
                      className="text-content-muted hover:text-critical"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {markers.length === 0 && (
              <tr>
                <td colSpan={4} className="p-4 text-center text-content-muted">
                  등록된 마커가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
