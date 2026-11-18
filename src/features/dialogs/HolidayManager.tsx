import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, FileUp, Trash2 } from 'lucide-react';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui/Button';
import { useProjectStore } from '@/app/store/useProjectStore';
import { generateKoreanHolidays } from '@/services/holiday/koreanHolidays';
import { HOLIDAY_KIND_LABEL, holidayKind, makeHoliday, type Holiday, type HolidayKind } from '@/entities';
import { formatDayKo, parseDateInput } from '@/shared/date/parseDateInput';
import { cn } from '@/shared/ui/cn';
import { tipProps } from '@/shared/ui/Tooltip';
import { askChoice } from '@/shared/ui/ChoiceDialog';
import { HOLIDAY_TEMPLATE, parseHolidayBulk, type BulkRow } from './holidayBulk';

type Tab = 'list' | 'bulk' | 'korea';
const KINDS: HolidayKind[] = ['public', 'substitute', 'company', 'other'];
const inputCls = 'h-8 rounded border border-border bg-surface px-2 text-xs text-content outline-none transition-colors focus:border-accent';

/** Holidays: list with in-place editing, bulk paste/import, Korean generator. */
export function HolidayManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('list');
  const count = useProjectStore((s) => s.derived.project.holidays.length);

  return (
    <Modal open={open} onClose={onClose} title="공휴일" width={780}>
      <p className="mb-3 rounded-md bg-surface px-3 py-2 text-2xs leading-relaxed text-content-muted">
        여기 등록한 날은 쉬는 날로 보고 작업 기간에서 뺍니다. (근무일 설정에서 &lsquo;공휴일 제외&rsquo;가 켜져 있을 때)
      </p>
      <div role="tablist" aria-label="공휴일 메뉴" className="mb-3 flex gap-1 border-b border-border">
        {([
          ['list', `목록 (${count})`],
          ['bulk', '여러 개 한 번에 넣기'],
          ['korea', '대한민국 공휴일 자동 생성'],
        ] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              '-mb-px h-9 border-b-2 px-3 text-xs',
              tab === id ? 'border-accent font-semibold text-accent' : 'border-transparent text-content-muted hover:text-content',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'list' && <ListTab onGoBulk={() => setTab('bulk')} />}
      {tab === 'bulk' && <BulkTab onDone={() => setTab('list')} />}
      {tab === 'korea' && <KoreaTab onDone={() => setTab('list')} />}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// 목록: add one, edit name/kind in place, select & delete many
// ---------------------------------------------------------------------------

function ListTab({ onGoBulk }: { onGoBulk: () => void }) {
  const holidays = useProjectStore((s) => s.derived.project.holidays);
  const upsertHoliday = useProjectStore((s) => s.upsertHoliday);
  const removeHolidays = useProjectStore((s) => s.removeHolidays);
  const showToast = useProjectStore((s) => s.showAppToast);

  const years = useMemo(() => [...new Set(holidays.map((h) => h.date.slice(0, 4)))].sort(), [holidays]);
  const [year, setYear] = useState('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const shown = holidays.filter((h) => year === 'all' || h.date.startsWith(year));

  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<HolidayKind>('company');
  const [error, setError] = useState('');

  const add = () => {
    const d = parseDateInput(date);
    if (!d.ok) { setError(d.message); return; }
    if (!name.trim()) { setError('이름을 입력하세요. 예: 창립기념일'); return; }
    const existed = holidays.find((h) => h.date === d.iso);
    upsertHoliday(makeHoliday(d.iso, name.trim(), kind));
    showToast(existed
      ? `${formatDayKo(d.iso)}에 있던 '${existed.name}'을(를) '${name.trim()}'(으)로 바꿨습니다.`
      : `${formatDayKo(d.iso)} '${name.trim()}'을(를) 추가했습니다.`, 'success');
    setDate(''); setName(''); setError('');
  };

  const allShownPicked = shown.length > 0 && shown.every((h) => picked.has(h.date));
  const toggleAll = () => setPicked(allShownPicked ? new Set() : new Set(shown.map((h) => h.date)));
  const deletePicked = async () => {
    const dates = [...picked];
    if (dates.length === 0) return;
    if (dates.length > 1) {
      const ok = await askChoice({
        title: `공휴일 ${dates.length}개를 지울까요?`,
        message: '지운 날은 다시 근무일로 계산됩니다. 되돌리기(Ctrl+Z)로 살릴 수 있습니다.',
        options: [{ value: 'yes', label: `${dates.length}개 지우기`, primary: true }],
      });
      if (!ok) return;
    }
    removeHolidays(dates);
    setPicked(new Set());
  };

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-2xs text-content-muted">날짜
          <input value={date} onChange={(e) => { setDate(e.target.value); setError(''); }} onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="20261225, 12/25" aria-invalid={!!error} className={cn(inputCls, 'mt-0.5 w-36', error && 'border-critical')} />
        </label>
        <label className="flex min-w-[160px] flex-1 flex-col text-2xs text-content-muted">이름
          <input value={name} onChange={(e) => { setName(e.target.value); setError(''); }} onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="예: 창립기념일" className={cn(inputCls, 'mt-0.5')} />
        </label>
        <label className="flex flex-col text-2xs text-content-muted">유형
          <select value={kind} onChange={(e) => setKind(e.target.value as HolidayKind)} className={cn(inputCls, 'mt-0.5 w-28')}>
            {KINDS.map((k) => <option key={k} value={k}>{HOLIDAY_KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <Button size="sm" variant="accent" onClick={add} className="h-8">추가</Button>
        <Button size="sm" onClick={onGoBulk} className="h-8" tip="여러 개 한 번에 넣기" tipDesc="엑셀에서 복사한 날짜·이름·유형 목록을 붙여넣어 한꺼번에 추가합니다.">여러 개 넣기…</Button>
      </div>
      <p role={error ? 'alert' : undefined} className={cn('mb-2 min-h-[18px] text-2xs', error ? 'text-critical' : 'text-content-muted')}>
        {error || '날짜는 20261225, 2026-12-25, 12/25(올해)처럼 쓸 수 있습니다. 이미 있는 날짜면 이름과 유형을 바꿉니다.'}
      </p>

      <div className="mb-2 flex items-center gap-2">
        <select value={year} onChange={(e) => { setYear(e.target.value); setPicked(new Set()); }} className={cn(inputCls, 'w-28')} aria-label="연도">
          <option value="all">모든 연도</option>
          {years.map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <span className="text-2xs text-content-muted">{shown.length}개 · 이름과 유형은 표에서 바로 고칠 수 있습니다</span>
        <div className="flex-1" />
        <Button size="sm" variant="danger" disabled={picked.size === 0} onClick={() => void deletePicked()}>
          <Trash2 size={13} /> 선택한 {picked.size}개 지우기
        </Button>
      </div>

      <div className="max-h-[320px] overflow-auto rounded border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-surface-2 text-content-muted">
            <tr>
              <th className="w-8 p-2"><input type="checkbox" checked={allShownPicked} onChange={toggleAll} aria-label="모두 선택" /></th>
              <th className="w-36 p-2 text-left">날짜</th>
              <th className="p-2 text-left">이름</th>
              <th className="w-32 p-2 text-left">유형</th>
              <th className="w-8 p-2" />
            </tr>
          </thead>
          <tbody>
            {shown.map((h) => (
              <HolidayRow key={h.date} h={h} picked={picked.has(h.date)}
                onPick={() => setPicked((p) => { const n = new Set(p); if (n.has(h.date)) n.delete(h.date); else n.add(h.date); return n; })} />
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={5} className="p-6 text-center text-content-muted">
                등록된 공휴일이 없습니다. 위에서 하나씩 넣거나 &lsquo;대한민국 공휴일 자동 생성&rsquo;, &lsquo;여러 개 한 번에 넣기&rsquo;를 쓰세요.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HolidayRow({ h, picked, onPick }: { h: Holiday; picked: boolean; onPick: () => void }) {
  const upsertHoliday = useProjectStore((s) => s.upsertHoliday);
  const removeHolidays = useProjectStore((s) => s.removeHolidays);
  const [name, setName] = useState(h.name);
  useEffect(() => setName(h.name), [h.name]); // follow undo/redo
  const kind = holidayKind(h);
  const saveName = () => {
    const v = name.trim();
    if (!v) { setName(h.name); return; }
    if (v !== h.name) upsertHoliday(makeHoliday(h.date, v, kind));
  };
  return (
    <tr className={cn('border-t border-border', picked ? 'bg-accent/5' : 'hover:bg-surface-2/60')}>
      <td className="p-2 text-center"><input type="checkbox" checked={picked} onChange={onPick} aria-label={`${h.date} 선택`} /></td>
      <td className="whitespace-nowrap p-2 text-content">{formatDayKo(h.date)}</td>
      <td className="p-1">
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setName(h.name); }}
          aria-label={`${h.date} 이름`}
          className="h-7 w-full rounded border border-transparent bg-transparent px-1.5 text-xs text-content outline-none hover:border-border focus:border-accent focus:bg-surface" />
      </td>
      <td className="p-1">
        <select value={kind} onChange={(e) => upsertHoliday(makeHoliday(h.date, h.name, e.target.value as HolidayKind))}
          aria-label={`${h.date} 유형`}
          className="h-7 w-full rounded border border-transparent bg-transparent px-1 text-xs text-content outline-none hover:border-border focus:border-accent">
          {KINDS.map((k) => <option key={k} value={k}>{HOLIDAY_KIND_LABEL[k]}</option>)}
        </select>
      </td>
      <td className="p-2 text-right">
        <button onClick={() => removeHolidays([h.date])} className="text-content-muted hover:text-critical" {...tipProps('지우기', `${h.date} ${h.name}을(를) 목록에서 지웁니다.`)}>
          <Trash2 size={14} />
        </button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// 여러 개 한 번에 넣기: paste or load a file, preview line by line, apply
// ---------------------------------------------------------------------------

const STATUS_STYLE: Record<BulkRow['status'], { label: string; cls: string }> = {
  add: { label: '추가', cls: 'bg-success/15 text-success' },
  update: { label: '바뀜', cls: 'bg-accent/15 text-accent' },
  same: { label: '그대로', cls: 'bg-surface-3 text-content-muted' },
  replaced: { label: '아래 줄로', cls: 'bg-surface-3 text-content-muted' },
  error: { label: '오류', cls: 'bg-critical/15 text-critical' },
};

function BulkTab({ onDone }: { onDone: () => void }) {
  const holidays = useProjectStore((s) => s.derived.project.holidays);
  const importHolidays = useProjectStore((s) => s.importHolidays);
  const showToast = useProjectStore((s) => s.showAppToast);
  const [text, setText] = useState('');
  const [defaultKind, setDefaultKind] = useState<HolidayKind>('company');
  const [skipWeekends, setSkipWeekends] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const baseYear = new Date().getFullYear();

  const rows = useMemo(
    () => parseHolidayBulk(text, holidays, { defaultKind, skipWeekends, baseYear }),
    [text, holidays, defaultKind, skipWeekends, baseYear],
  );
  const toApply = rows.filter((r) => r.status === 'add' || r.status === 'update').flatMap((r) => r.holidays);
  const n = (s: BulkRow['status']) => rows.filter((r) => r.status === s).length;
  const errors = n('error');

  const apply = () => {
    if (toApply.length === 0) return;
    const { added, updated } = importHolidays(toApply);
    showToast(
      `공휴일 ${added}개를 추가했습니다${updated ? `, ${updated}개는 이름·유형을 바꿨습니다` : ''}.` +
      (errors ? `\n오류가 있는 ${errors}줄은 넣지 않았습니다. 고쳐서 다시 넣을 수 있도록 남겨 두었습니다.` : ''),
      errors ? 'error' : 'success',
    );
    // Keep only the lines that failed, so they can be fixed and re-applied.
    const failed = rows.filter((r) => r.status === 'error').map((r) => r.text);
    setText(failed.join('\n'));
    if (failed.length === 0) onDone();
  };

  const loadFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 1_000_000) { showToast('파일이 너무 큽니다(1MB 초과). 날짜·이름·유형 열만 있는 CSV나 텍스트 파일을 쓰세요.', 'error'); return; }
    const content = await f.text();
    setText((t) => (t.trim() ? `${t.trim()}\n${content}` : content));
  };

  const copyTemplate = async () => {
    try {
      await navigator.clipboard.writeText(HOLIDAY_TEMPLATE);
      showToast('양식을 복사했습니다. 엑셀에 붙여넣어 채운 뒤, 그 칸들을 복사해 여기에 붙여넣으세요.', 'success');
    } catch {
      setText(HOLIDAY_TEMPLATE);
    }
  };

  return (
    <div>
      <div className="mb-2 grid gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-2xs leading-relaxed text-content-muted">
        <span>한 줄에 하나씩 <b className="text-content">날짜 · 이름 · 유형</b>을 씁니다. 엑셀에서 세 칸을 골라 복사해 그대로 붙여넣어도 됩니다.</span>
        <span>기간은 <code className="text-content">2026-12-29~2026-12-31</code>처럼 쓰면 하루씩 펼쳐 넣습니다. 유형은 공휴일 / 대체 / 회사 / 기타 중 하나이고, 비우면 아래 &lsquo;기본 유형&rsquo;을 씁니다.</span>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-content">기본 유형
          <select value={defaultKind} onChange={(e) => setDefaultKind(e.target.value as HolidayKind)} className={cn(inputCls, 'h-7 w-28')}>
            {KINDS.map((k) => <option key={k} value={k}>{HOLIDAY_KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-content" {...tipProps('기간에서 주말 빼기', '토·일은 원래 쉬는 날이라 목록에 넣지 않습니다. 근무 요일에 토요일이 있다면 끄세요.')}>
          <input type="checkbox" checked={skipWeekends} onChange={(e) => setSkipWeekends(e.target.checked)} />
          기간에서 주말 빼기
        </label>
        <div className="flex-1" />
        <Button size="sm" onClick={() => void copyTemplate()} tip="엑셀 양식 복사" tipDesc="날짜·이름·유형 머리글과 예시가 들어 있는 양식을 복사합니다. 엑셀에 붙여넣어 쓰세요.">
          <Copy size={13} /> 엑셀 양식 복사
        </Button>
        <Button size="sm" onClick={() => fileRef.current?.click()} tip="파일에서 불러오기" tipDesc="CSV 또는 텍스트 파일(날짜, 이름, 유형)을 읽어 아래 칸에 넣습니다.">
          <FileUp size={13} /> 파일에서 불러오기
        </Button>
        <input ref={fileRef} type="file" accept=".csv,.txt,.tsv,text/plain,text/csv" className="hidden"
          onChange={(e) => { void loadFile(e.target.files?.[0]); e.target.value = ''; }} />
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        spellCheck={false}
        aria-label="공휴일 목록 붙여넣기"
        placeholder={'2026-12-25\t성탄절\t공휴일\n2026-04-15, 창립기념일, 회사\n2026-12-29~2026-12-31 연말 휴무 회사'}
        className="mb-2 w-full resize-y rounded border border-border bg-surface p-2 font-mono text-xs leading-relaxed text-content outline-none focus:border-accent"
      />

      {rows.length > 0 && (
        <>
          <div className="mb-1 flex flex-wrap items-center gap-3 text-2xs text-content-muted">
            <span>미리보기 {rows.length}줄</span>
            <span className="text-success">추가 {n('add')}</span>
            <span className="text-accent">바뀜 {n('update')}</span>
            {n('same') > 0 && <span>그대로 {n('same')}</span>}
            {errors > 0 && <span className="font-semibold text-critical">오류 {errors}줄 — 이 줄들은 넣지 않습니다</span>}
          </div>
          <div className="mb-3 max-h-[200px] overflow-auto rounded border border-border">
            <table className="w-full text-xs">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.line} className="border-t border-border first:border-t-0">
                    <td className="w-10 whitespace-nowrap p-1.5 text-right text-2xs text-content-muted">{r.line}행</td>
                    <td className="w-20 p-1.5">
                      <span className={cn('whitespace-nowrap rounded px-1.5 py-0.5 text-2xs font-semibold', STATUS_STYLE[r.status].cls)}>
                        {STATUS_STYLE[r.status].label}
                      </span>
                    </td>
                    <td className={cn('p-1.5', r.status === 'error' ? 'text-critical' : 'text-content')}>
                      {r.message}
                      {r.status === 'error' && <div className="truncate font-mono text-2xs text-content-muted">{r.text}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="flex items-center justify-end gap-2">
        {text && <Button size="sm" onClick={() => setText('')}>모두 지우기</Button>}
        <Button size="sm" variant="accent" disabled={toApply.length === 0} onClick={apply}>
          {toApply.length > 0 ? `${toApply.length}일 넣기` : '넣을 내용이 없습니다'}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 대한민국 공휴일 자동 생성
// ---------------------------------------------------------------------------

function KoreaTab({ onDone }: { onDone: () => void }) {
  const importHolidays = useProjectStore((s) => s.importHolidays);
  const holidays = useProjectStore((s) => s.derived.project.holidays);
  const showToast = useProjectStore((s) => s.showAppToast);
  const thisYear = new Date().getFullYear();
  const [fromYear, setFromYear] = useState(thisYear);
  const [toYear, setToYear] = useState(thisYear + 1);
  const valid = fromYear >= 1900 && toYear <= 2200 && fromYear <= toYear && toYear - fromYear <= 50;
  const generated = useMemo(() => (valid ? generateKoreanHolidays(fromYear, toYear) : []), [valid, fromYear, toYear]);
  const custom = holidays.filter((h) => { const k = holidayKind(h); return k === 'company' || k === 'other'; });
  const customDates = new Set(custom.map((h) => h.date));
  const willAdd = generated.filter((h) => !customDates.has(h.date));

  const run = () => {
    const { added, updated } = importHolidays(willAdd);
    showToast(`${fromYear}~${toYear}년 대한민국 공휴일 ${added}개를 넣었습니다${updated ? ` (${updated}개는 이미 있어 최신 이름으로 맞춤)` : ''}. 회사 휴무·기타 휴무는 그대로 두었습니다.`, 'success');
    onDone();
  };

  return (
    <div>
      <p className="mb-3 text-xs leading-relaxed text-content-muted">
        설날·추석 연휴와 대체공휴일까지 자동으로 계산해 넣습니다. 직접 넣은 &lsquo;회사 휴무&rsquo;와 &lsquo;기타 휴무&rsquo;는 지우거나 덮어쓰지 않습니다.
        임시 공휴일처럼 정부가 따로 정하는 날은 직접 추가하세요.
      </p>
      <div className="mb-2 flex items-end gap-2">
        <label className="flex flex-col text-2xs text-content-muted">시작 연도
          <input type="number" value={fromYear} onChange={(e) => setFromYear(Number(e.target.value))} className={cn(inputCls, 'mt-0.5 w-24')} />
        </label>
        <span className="pb-2 text-content-muted">~</span>
        <label className="flex flex-col text-2xs text-content-muted">끝 연도
          <input type="number" value={toYear} onChange={(e) => setToYear(Number(e.target.value))} className={cn(inputCls, 'mt-0.5 w-24')} />
        </label>
        <Button size="sm" variant="accent" disabled={!valid || willAdd.length === 0} onClick={run} className="h-8">
          {valid ? `공휴일 ${willAdd.length}개 넣기` : '연도를 확인하세요'}
        </Button>
      </div>
      <p className={cn('text-2xs', valid ? 'text-content-muted' : 'text-critical')}>
        {valid
          ? `${fromYear}년부터 ${toYear}년까지 ${generated.length}개가 계산됩니다.${generated.length > willAdd.length ? ` 그중 ${generated.length - willAdd.length}개는 같은 날 회사 휴무가 있어 건너뜁니다.` : ''}`
          : '시작 연도가 끝 연도보다 늦거나, 1900~2200년 범위를 벗어났거나, 50년이 넘습니다.'}
      </p>
    </div>
  );
}
