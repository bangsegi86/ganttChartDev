import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';
import { nanoid } from 'nanoid';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui/Button';
import { useProjectStore } from '@/app/store/useProjectStore';
import type { Resource } from '@/entities';
import { cn } from '@/shared/ui/cn';
import { tipProps } from '@/shared/ui/Tooltip';
import { askChoice } from '@/shared/ui/ChoiceDialog';

const SWATCHES = ['#2F6FEB', '#0B8A6E', '#E8590C', '#D6336C', '#7048E8', '#0C8599', '#5C940D', '#868E96'];
const inputCls = 'h-8 rounded border border-border bg-surface px-2 text-xs text-content outline-none transition-colors focus:border-accent';
const MIN_H = 0.5;
const MAX_H = 24;

/** Check a resource field; returns an error message or null. */
function validate(field: 'name' | 'hours', value: string, others: Resource[]): string | null {
  if (field === 'name') {
    const v = value.trim();
    if (!v) return '이름을 입력하세요.';
    if (v.length > 40) return '이름은 40자까지 쓸 수 있습니다.';
    if (others.some((r) => r.name.trim().toLowerCase() === v.toLowerCase())) {
      return `'${v}'은(는) 이미 있습니다. 표에서 이름이 같으면 담당자를 구분하기 어렵습니다.`;
    }
    return null;
  }
  const n = Number(value);
  if (value.trim() === '' || !Number.isFinite(n)) return '하루 근무시간은 숫자로 입력하세요. 예: 8';
  if (n < MIN_H || n > MAX_H) return `하루 근무시간은 ${MIN_H}시간부터 ${MAX_H}시간 사이로 입력하세요.`;
  return null;
}

/** People work can be assigned to: add, edit in place, remove. */
export function ResourceManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const resources = useProjectStore((s) => s.derived.project.resources);
  const tasks = useProjectStore((s) => s.derived.project.tasks);
  const upsert = useProjectStore((s) => s.upsertResource);
  const showToast = useProjectStore((s) => s.showAppToast);

  const assigned = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) for (const id of t.assigneeIds) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [tasks]);

  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [hours, setHours] = useState('8');
  const [color, setColor] = useState(SWATCHES[0]!);
  const [error, setError] = useState('');

  const add = () => {
    const err = validate('name', name, resources) ?? validate('hours', hours, resources);
    if (err) { setError(err); return; }
    upsert({ id: nanoid(8), name: name.trim(), role: role.trim().slice(0, 30), color, capacityHoursPerDay: Number(hours) });
    showToast(`담당자 '${name.trim()}'을(를) 추가했습니다.`, 'success');
    setName(''); setRole(''); setError('');
    setColor(SWATCHES[(SWATCHES.indexOf(color) + 1) % SWATCHES.length]!);
  };

  return (
    <Modal open={open} onClose={onClose} title="담당자 관리" width={720}>
      <p className="mb-3 rounded-md bg-surface px-3 py-2 text-2xs leading-relaxed text-content-muted">
        작업을 맡을 사람을 등록합니다. 하루 근무시간을 넣어 두면 &lsquo;담당자별 업무량&rsquo; 화면에서 그보다 일이 많이 잡힌 날을 빨갛게 보여 줍니다.
        아래 표의 이름·역할·시간·색은 눌러서 바로 고칠 수 있습니다.
      </p>

      <div className="mb-1 flex flex-wrap items-end gap-2">
        <label className="flex min-w-[140px] flex-1 flex-col text-2xs text-content-muted">이름
          <input value={name} onChange={(e) => { setName(e.target.value); setError(''); }} onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="예: 홍길동" className={cn(inputCls, 'mt-0.5')} />
        </label>
        <label className="flex flex-col text-2xs text-content-muted">역할
          <input value={role} onChange={(e) => setRole(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="예: 백엔드" className={cn(inputCls, 'mt-0.5 w-32')} />
        </label>
        <label className="flex flex-col text-2xs text-content-muted">하루 근무시간
          <span className="mt-0.5 flex items-center gap-1">
            <input type="number" min={MIN_H} max={MAX_H} step={0.5} value={hours}
              onChange={(e) => { setHours(e.target.value); setError(''); }} onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
              className={cn(inputCls, 'w-16')} />
            <span className="text-xs text-content-muted">시간</span>
          </span>
        </label>
        <div className="flex flex-col text-2xs text-content-muted">색
          <span className="mt-0.5"><ColorPicker value={color} onChange={setColor} label="새 담당자 색" /></span>
        </div>
        <Button size="sm" variant="accent" onClick={add} className="h-8">추가</Button>
      </div>
      <p role={error ? 'alert' : undefined} className={cn('mb-3 min-h-[18px] text-2xs', error ? 'text-critical' : 'text-content-muted')}>
        {error || '하루 근무시간은 보통 8시간입니다. 반일 근무라면 4처럼 넣으세요.'}
      </p>

      <div className="max-h-[340px] overflow-auto rounded border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-surface-2 text-content-muted">
            <tr>
              <th className="w-12 p-2 text-left">색</th>
              <th className="p-2 text-left">이름</th>
              <th className="w-36 p-2 text-left">역할</th>
              <th className="w-32 p-2 text-left">하루 근무시간</th>
              <th className="w-24 p-2 text-right">맡은 작업</th>
              <th className="w-8 p-2" />
            </tr>
          </thead>
          <tbody>
            {resources.map((r) => <ResourceRow key={r.id} r={r} taskCount={assigned.get(r.id) ?? 0} others={resources.filter((o) => o.id !== r.id)} />)}
            {resources.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-content-muted">등록된 담당자가 없습니다. 위에서 이름을 넣고 추가하세요.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function ResourceRow({ r, taskCount, others }: { r: Resource; taskCount: number; others: Resource[] }) {
  const upsert = useProjectStore((s) => s.upsertResource);
  const remove = useProjectStore((s) => s.removeResource);
  const showToast = useProjectStore((s) => s.showAppToast);
  const [name, setName] = useState(r.name);
  const [role, setRole] = useState(r.role);
  const [hours, setHours] = useState(String(r.capacityHoursPerDay));
  const [error, setError] = useState('');
  // Follow undo/redo and other edits.
  useEffect(() => setName(r.name), [r.name]);
  useEffect(() => setRole(r.role), [r.role]);
  useEffect(() => setHours(String(r.capacityHoursPerDay)), [r.capacityHoursPerDay]);

  const save = (field: 'name' | 'role' | 'hours') => {
    if (field === 'role') {
      const v = role.trim().slice(0, 30);
      if (v !== r.role) upsert({ ...r, role: v });
      return;
    }
    const value = field === 'name' ? name : hours;
    const err = validate(field, value, others);
    if (err) {
      setError(err);
      showToast(`'${r.name}': ${err} 원래 값으로 되돌렸습니다.`, 'error');
      if (field === 'name') setName(r.name); else setHours(String(r.capacityHoursPerDay));
      return;
    }
    setError('');
    if (field === 'name' && name.trim() !== r.name) upsert({ ...r, name: name.trim() });
    if (field === 'hours' && Number(hours) !== r.capacityHoursPerDay) {
      upsert({ ...r, capacityHoursPerDay: Number(hours) });
      showToast(`'${r.name}'의 하루 근무시간을 ${Number(hours)}시간으로 바꿨습니다. 업무량 화면에 바로 반영됩니다.`, 'success');
    }
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, reset: () => void) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    if (e.key === 'Escape') { reset(); setError(''); }
  };

  const del = async () => {
    if (taskCount > 0) {
      const ok = await askChoice({
        title: `'${r.name}'을(를) 지울까요?`,
        message: `'${r.name}'이(가) 맡은 작업이 ${taskCount}개 있습니다. 지우면 그 작업들의 담당자에서 빠집니다. (되돌리기: Ctrl+Z)`,
        options: [{ value: 'yes', label: `지우고 작업 ${taskCount}개에서 담당자 빼기`, primary: true }],
      });
      if (!ok) return;
    }
    remove(r.id);
    showToast(`담당자 '${r.name}'을(를) 지웠습니다.`, 'success');
  };

  const cell = 'h-7 w-full rounded border border-transparent bg-transparent px-1.5 text-xs text-content outline-none hover:border-border focus:border-accent focus:bg-surface';
  return (
    <tr className="border-t border-border hover:bg-surface-2/60">
      <td className="p-2"><ColorPicker value={r.color} onChange={(c) => upsert({ ...r, color: c })} label={`${r.name} 색`} /></td>
      <td className="p-1">
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => save('name')}
          onKeyDown={(e) => onKey(e, () => setName(r.name))} aria-label={`${r.name} 이름`} aria-invalid={!!error}
          className={cn(cell, 'font-medium')} />
      </td>
      <td className="p-1">
        <input value={role} onChange={(e) => setRole(e.target.value)} onBlur={() => save('role')}
          onKeyDown={(e) => onKey(e, () => setRole(r.role))} placeholder="역할 없음" aria-label={`${r.name} 역할`} className={cn(cell, 'placeholder:text-content-muted/60')} />
      </td>
      <td className="p-1">
        <span className="flex items-center gap-1">
          <input type="number" min={MIN_H} max={MAX_H} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} onBlur={() => save('hours')}
            onKeyDown={(e) => onKey(e, () => setHours(String(r.capacityHoursPerDay)))} aria-label={`${r.name} 하루 근무시간`}
            className={cell.replace('w-full', 'w-16')} />
          <span className="text-content-muted">시간</span>
        </span>
      </td>
      <td className="whitespace-nowrap p-2 text-right text-content-muted">{taskCount}개</td>
      <td className="p-2 text-right">
        <button onClick={() => void del()} className="text-content-muted hover:text-critical" {...tipProps('지우기', taskCount ? `맡은 작업 ${taskCount}개의 담당자에서도 빠집니다.` : '이 담당자를 지웁니다.')}>
          <Trash2 size={14} />
        </button>
      </td>
    </tr>
  );
}

/** Small colour button with a swatch popover. */
function ColorPicker({ value, onChange, label }: { value: string; onChange: (c: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('[data-color-pop]') || btn.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <>
      <button
        ref={btn}
        onClick={() => { const r = btn.current?.getBoundingClientRect(); if (r) setPos({ top: r.bottom + 4, left: r.left }); setOpen((o) => !o); }}
        aria-label={label}
        aria-expanded={open}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-border hover:border-content-muted/60"
      >
        <span className="h-4 w-4 rounded-full" style={{ background: value }} />
      </button>
      {open && createPortal(
        <div data-color-pop style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 10000 }}
          className="grid grid-cols-4 gap-1.5 rounded-lg border border-border bg-surface p-2 shadow-xl">
          {SWATCHES.map((c) => (
            <button key={c} onClick={() => { onChange(c); setOpen(false); }} aria-label={`색 ${c}`} aria-pressed={value === c}
              className="h-6 w-6 rounded-full transition-transform hover:scale-110"
              style={{ background: c, outline: value === c ? '2px solid rgb(var(--color-accent))' : '2px solid transparent', outlineOffset: 2 }} />
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
