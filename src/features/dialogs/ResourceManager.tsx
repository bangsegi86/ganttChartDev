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

/**
 * People work can be assigned to. Click a row to load it into the form above,
 * change it there and press 수정 (confirmed with a summary of the changes).
 */
export function ResourceManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const resources = useProjectStore((s) => s.derived.project.resources);
  const tasks = useProjectStore((s) => s.derived.project.tasks);
  const upsert = useProjectStore((s) => s.upsertResource);
  const remove = useProjectStore((s) => s.removeResource);
  const showToast = useProjectStore((s) => s.showAppToast);

  const assigned = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) for (const id of t.assigneeIds) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [tasks]);

  /** Resource loaded into the form, or null when adding a new one. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = resources.find((r) => r.id === editingId) ?? null;
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [hours, setHours] = useState('8');
  const [color, setColor] = useState(SWATCHES[0]!);
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  // The edited person was removed (e.g. undo): back to "add" mode.
  useEffect(() => { if (editingId && !editing) resetForm(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [editingId, editing]);
  // Closing the dialog leaves edit mode.
  useEffect(() => { if (!open) resetForm(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);

  function resetForm(nextColor?: string) {
    setEditingId(null);
    setName(''); setRole(''); setHours('8'); setError('');
    if (nextColor) setColor(nextColor);
  }

  /** What would change if the form were applied to `r`. */
  function changesFor(r: Resource): string[] {
    const out: string[] = [];
    const oldRole = r.role ?? '';
    if (name.trim() !== r.name) out.push(`이름: ${r.name} → ${name.trim()}`);
    if (role.trim() !== oldRole) out.push(`역할: ${oldRole || '없음'} → ${role.trim() || '없음'}`);
    if (Number(hours) !== r.capacityHoursPerDay) out.push(`하루 근무시간: ${r.capacityHoursPerDay}시간 → ${Number(hours)}시간 (업무량 화면에 바로 반영)`);
    if (color !== r.color) out.push('색: 바뀜');
    return out;
  }
  const dirty = editing ? changesFor(editing).length > 0 : name.trim() !== '' || role.trim() !== '';

  const load = async (r: Resource) => {
    if (r.id === editingId) return;
    if (dirty) {
      const pick = await askChoice({
        title: '입력 중인 내용이 있습니다',
        message: editing
          ? `'${editing.name}'에서 고친 내용을 저장하지 않고 '${r.name}'을(를) 불러올까요?`
          : `입력하던 새 담당자 내용을 버리고 '${r.name}'을(를) 불러올까요?`,
        options: [{ value: 'load', label: `저장하지 않고 '${r.name}' 불러오기`, primary: true }],
        cancelLabel: '계속 입력하기',
      });
      if (!pick) return;
    }
    setEditingId(r.id);
    setName(r.name ?? ''); setRole(r.role ?? ''); setHours(String(r.capacityHoursPerDay ?? 8)); setColor(r.color || SWATCHES[0]!); setError('');
    setTimeout(() => nameRef.current?.focus(), 0);
  };

  const check = (others: Resource[]) => validate('name', name, others) ?? validate('hours', hours, others);

  const add = () => {
    const err = check(resources);
    if (err) { setError(err); return; }
    upsert({ id: nanoid(8), name: name.trim(), role: role.trim().slice(0, 30), color, capacityHoursPerDay: Number(hours) });
    showToast(`담당자 '${name.trim()}'을(를) 추가했습니다.`, 'success');
    resetForm(SWATCHES[(SWATCHES.indexOf(color) + 1) % SWATCHES.length]);
  };

  const save = async () => {
    if (!editing) return;
    const err = check(resources.filter((o) => o.id !== editing.id));
    if (err) { setError(err); return; }
    const changes = changesFor(editing);
    if (changes.length === 0) { setError('바뀐 내용이 없습니다. 고칠 칸을 바꾼 뒤 수정을 누르세요.'); return; }
    const ok = await askChoice({
      title: `'${editing.name}' 정보를 수정할까요?`,
      message: changes.join('\n'),
      options: [{ value: 'save', label: '수정하기', primary: true }],
      cancelLabel: '돌아가기',
    });
    if (!ok) return;
    upsert({ ...editing, name: name.trim(), role: role.trim().slice(0, 30), color, capacityHoursPerDay: Number(hours) });
    showToast(`'${name.trim()}' 정보를 수정했습니다. (되돌리기: Ctrl+Z)`, 'success');
    resetForm(color);
  };

  const del = async () => {
    if (!editing) return;
    const count = assigned.get(editing.id) ?? 0;
    const ok = await askChoice({
      title: `'${editing.name}'을(를) 지울까요?`,
      message: count > 0
        ? `'${editing.name}'이(가) 맡은 작업이 ${count}개 있습니다. 지우면 그 작업들의 담당자에서 빠집니다. (되돌리기: Ctrl+Z)`
        : '지운 뒤에도 되돌리기(Ctrl+Z)로 살릴 수 있습니다.',
      options: [{ value: 'yes', label: count > 0 ? `지우고 작업 ${count}개에서 담당자 빼기` : '지우기', primary: true }],
    });
    if (!ok) return;
    remove(editing.id);
    showToast(`담당자 '${editing.name}'을(를) 지웠습니다.`, 'success');
    resetForm();
  };

  const submit = () => { if (editing) void save(); else add(); };
  const onEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') submit(); };

  return (
    <Modal open={open} onClose={onClose} title="담당자 관리" width={720}>
      <p className="mb-3 rounded-md bg-surface px-3 py-2 text-2xs leading-relaxed text-content-muted">
        작업을 맡을 사람을 등록합니다. 하루 근무시간을 넣어 두면 &lsquo;담당자별 업무량&rsquo; 화면에서 그보다 일이 많이 잡힌 날을 빨갛게 보여 줍니다.
        아래 표에서 사람을 누르면 위 칸에 불러와 고칠 수 있습니다.
      </p>

      <div className={cn('mb-3 rounded-lg border p-3', editing ? 'border-accent/50 bg-accent/5' : 'border-border')}>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-content">
            {editing ? `'${editing.name}' 수정 중` : '새 담당자 추가'}
          </span>
          {editing && (
            <button onClick={() => resetForm()} className="text-2xs text-accent hover:underline">
              수정 그만두고 새로 추가하기
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[140px] flex-1 flex-col text-2xs text-content-muted">이름
            <input ref={nameRef} value={name} onChange={(e) => { setName(e.target.value); setError(''); }} onKeyDown={onEnter}
              placeholder="예: 홍길동" className={cn(inputCls, 'mt-0.5')} />
          </label>
          <label className="flex flex-col text-2xs text-content-muted">역할
            <input value={role} onChange={(e) => { setRole(e.target.value); setError(''); }} onKeyDown={onEnter}
              placeholder="예: 백엔드" className={cn(inputCls, 'mt-0.5 w-32')} />
          </label>
          <label className="flex flex-col text-2xs text-content-muted">하루 근무시간
            <span className="mt-0.5 flex items-center gap-1">
              <input type="number" min={MIN_H} max={MAX_H} step={0.5} value={hours}
                onChange={(e) => { setHours(e.target.value); setError(''); }} onKeyDown={onEnter}
                className={cn(inputCls, 'w-16')} />
              <span className="text-xs text-content-muted">시간</span>
            </span>
          </label>
          <div className="flex flex-col text-2xs text-content-muted">색
            <span className="mt-0.5"><ColorPicker value={color} onChange={(c) => { setColor(c); setError(''); }} label="담당자 색" /></span>
          </div>
          {editing ? (
            <>
              <Button size="sm" variant="accent" onClick={() => void save()} className="h-8">수정</Button>
              <Button size="sm" variant="danger" onClick={() => void del()} className="h-8"
                tip="이 담당자 지우기" tipDesc="맡은 작업이 있으면 그 작업들의 담당자에서도 빠집니다. 지우기 전에 한 번 더 묻습니다.">
                <Trash2 size={13} /> 삭제
              </Button>
            </>
          ) : (
            <Button size="sm" variant="accent" onClick={add} className="h-8">추가</Button>
          )}
        </div>
        <p role={error ? 'alert' : undefined} className={cn('mt-1.5 min-h-[18px] text-2xs', error ? 'text-critical' : 'text-content-muted')}>
          {error || (editing
            ? '칸을 고친 뒤 수정을 누르면, 바뀌는 내용을 보여 주고 한 번 더 확인합니다.'
            : '하루 근무시간은 보통 8시간입니다. 반일 근무라면 4처럼 넣으세요.')}
        </p>
      </div>

      <div className="max-h-[320px] overflow-auto rounded border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-surface-2 text-content-muted">
            <tr>
              <th className="w-12 p-2 text-left">색</th>
              <th className="p-2 text-left">이름</th>
              <th className="w-36 p-2 text-left">역할</th>
              <th className="w-28 p-2 text-right">하루 근무시간</th>
              <th className="w-24 p-2 text-right">맡은 작업</th>
            </tr>
          </thead>
          <tbody>
            {resources.map((r) => {
              const active = r.id === editingId;
              return (
                <tr key={r.id} onClick={() => void load(r)}
                  className={cn('cursor-pointer border-t border-border', active ? 'bg-accent/10' : 'hover:bg-surface-2/60')}>
                  <td className="p-2"><span className="ml-1.5 inline-block h-3.5 w-3.5 rounded-full align-middle" style={{ background: r.color }} /></td>
                  <td className="p-2">
                    {/* A real button so the row is reachable with the keyboard. */}
                    <button onClick={(e) => { e.stopPropagation(); void load(r); }} aria-pressed={active}
                      className={cn('text-left font-medium hover:underline', active ? 'text-accent' : 'text-content')}
                      {...tipProps(`'${r.name}' 불러오기`, '위 입력란에 불러와 고치거나 지울 수 있습니다.')}>
                      {r.name}
                    </button>
                  </td>
                  <td className="p-2 text-content-muted">{r.role || '—'}</td>
                  <td className="whitespace-nowrap p-2 text-right text-content">{r.capacityHoursPerDay}시간</td>
                  <td className="whitespace-nowrap p-2 text-right text-content-muted">{assigned.get(r.id) ?? 0}개</td>
                </tr>
              );
            })}
            {resources.length === 0 && (
              <tr><td colSpan={5} className="p-6 text-center text-content-muted">등록된 담당자가 없습니다. 위에서 이름을 넣고 추가하세요.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
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
