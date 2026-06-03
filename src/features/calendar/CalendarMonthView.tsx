import { memo, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Diamond } from 'lucide-react';
import { useVisibleTasks } from '@/features/view/viewFilter';
import { useProjectStore } from '@/app/store/useProjectStore';
import { todayISO } from '@/shared/date/dateUtils';
import { cn } from '@/shared/ui/cn';
import { Modal } from '@/shared/ui/Modal';
import type { Task } from '@/entities';

const DOW_LABELS = ['월', '화', '수', '목', '금', '토', '일'];

function buildCells(year: number, month: number): (string | null)[] {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const first = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDow = (first.getDay() + 6) % 7; // Mon=0 … Sun=6
  const cells: (string | null)[] = Array<null>(firstDow).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${pad2(month)}-${pad2(d)}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Advance a {year, month} by `delta` months. */
function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  let m = month - 1 + delta; // 0-based
  const y = year + Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  return { year: y, month: m + 1 };
}

/** All tasks (milestones first) active on a given ISO date. */
function allTasksForDay(date: string, tasks: Task[]): Task[] {
  const matching = tasks.filter((t) => !t.isMilestone && t.start <= date && t.end >= date);
  const milestones = tasks.filter((t) => t.isMilestone && t.start === date);
  return [...milestones, ...matching];
}

function tasksForDay(date: string, tasks: Task[], limit: number): { visible: Task[]; overflow: number } {
  const all = allTasksForDay(date, tasks);
  return { visible: all.slice(0, limit), overflow: Math.max(0, all.length - limit) };
}

function taskColor(t: Task): string {
  return t.color ?? '#3b82f6';
}

// ---------------------------------------------------------------------------
// Single-month grid (memoized so sibling months don't re-render each other)
// ---------------------------------------------------------------------------

interface MonthGridProps {
  year: number;
  month: number;
  tasks: Task[];
  today: string;
  taskLimit: number;
  setInspecting: (id: string) => void;
  setPopupDate: (date: string) => void;
}

const MonthGrid = memo(function MonthGrid({
  year,
  month,
  tasks,
  today,
  taskLimit,
  setInspecting,
  setPopupDate,
}: MonthGridProps) {
  const cells = useMemo(() => buildCells(year, month), [year, month]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-l border-border first:border-l-0">
      {/* Month title */}
      <div className="shrink-0 border-b border-border py-1.5 text-center text-xs font-semibold text-content">
        {year}년 {month}월
      </div>

      {/* Day-of-week header */}
      <div className="grid shrink-0 grid-cols-7 border-b border-border">
        {DOW_LABELS.map((d, i) => (
          <div
            key={d}
            className={cn(
              'py-1 text-center text-2xs font-semibold',
              i >= 5 ? 'text-critical/70' : 'text-content-muted',
            )}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div
        className="grid min-h-0 flex-1 grid-cols-7 overflow-y-auto"
        style={{ gridAutoRows: '1fr' }}
      >
        {cells.map((date, idx) => {
          if (!date) {
            return (
              <div key={`empty-${idx}`} className="border-b border-r border-border bg-surface-2/30" />
            );
          }
          const isToday = date === today;
          const dayNum = parseInt(date.slice(8), 10);
          const isWeekend = idx % 7 >= 5;
          const { visible, overflow } = tasksForDay(date, tasks, taskLimit);

          return (
            <div
              key={date}
              className={cn(
                'flex flex-col border-b border-r border-border p-1',
                isWeekend ? 'bg-surface-2/40' : 'bg-surface',
              )}
            >
              <span
                className={cn(
                  'mb-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-medium',
                  isToday
                    ? 'bg-accent text-white'
                    : isWeekend
                      ? 'text-critical/70'
                      : 'text-content-muted',
                )}
              >
                {dayNum}
              </span>
              <div className="flex flex-col gap-0.5 overflow-hidden">
                {visible.map((t) => (
                  <div
                    key={t.id}
                    className="flex cursor-pointer items-center gap-0.5 truncate rounded px-1 text-[10px] leading-[14px] text-white transition-opacity hover:opacity-80"
                    style={{ background: taskColor(t) }}
                    title={t.name}
                    onClick={() => setInspecting(t.id)}
                  >
                    {t.isMilestone && <Diamond size={8} className="shrink-0" />}
                    <span className="truncate">{t.name}</span>
                  </div>
                ))}
                {overflow > 0 && (
                  <button
                    type="button"
                    onClick={() => setPopupDate(date)}
                    className="cursor-pointer pl-1 text-left text-[10px] text-content-muted hover:font-bold hover:text-content"
                    title="이 날짜의 모든 일정 보기"
                  >
                    +{overflow}개
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function CalendarMonthView() {
  const today = todayISO();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [colCount, setColCount] = useState<1 | 2 | 3>(1);
  const [popupDate, setPopupDate] = useState<string | null>(null);

  const tasks = useVisibleTasks();
  const setInspecting = useProjectStore((s) => s.setInspecting);

  // Build the list of {year, month} for each visible column.
  const months = useMemo(
    () => Array.from({ length: colCount }, (_, i) => addMonths(year, month, i)),
    [year, month, colCount],
  );

  const popupTasks = useMemo(
    () => (popupDate ? allTasksForDay(popupDate, tasks) : []),
    [popupDate, tasks],
  );

  const prevMonth = () => {
    const prev = addMonths(year, month, -1);
    setYear(prev.year); setMonth(prev.month);
  };
  const nextMonth = () => {
    const next = addMonths(year, month, 1);
    setYear(next.year); setMonth(next.month);
  };
  const goToday = () => {
    setYear(new Date().getFullYear());
    setMonth(new Date().getMonth() + 1);
  };

  // Title: "2026년 6월" or "2026년 6월 – 8월" etc.
  const first = months[0]!;
  const last = months[months.length - 1]!;
  const title =
    colCount === 1
      ? `${first.year}년 ${first.month}월`
      : first.year === last.year
        ? `${first.year}년 ${first.month}월 – ${last.month}월`
        : `${first.year}년 ${first.month}월 – ${last.year}년 ${last.month}월`;

  // Fewer tasks shown per cell when columns are narrow.
  const taskLimit = colCount === 3 ? 1 : colCount === 2 ? 2 : 3;

  return (
    <div className="flex h-full w-full flex-1 flex-col overflow-hidden bg-surface">
      {/* Navigation header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <button
          onClick={prevMonth}
          className="rounded p-1 text-content-muted transition-colors hover:bg-surface-2 hover:text-content"
          aria-label="이전 달"
        >
          <ChevronLeft size={16} />
        </button>
        <h2 className="min-w-[140px] text-center text-sm font-semibold text-content">
          {title}
        </h2>
        <button
          onClick={nextMonth}
          className="rounded p-1 text-content-muted transition-colors hover:bg-surface-2 hover:text-content"
          aria-label="다음 달"
        >
          <ChevronRight size={16} />
        </button>
        <button
          onClick={goToday}
          className="ml-2 rounded border border-border px-2 py-0.5 text-xs text-content transition-colors hover:bg-surface-2"
        >
          오늘
        </button>

        {/* Column count toggle */}
        <div className="ml-auto flex items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5">
          {([1, 2, 3] as const).map((n) => (
            <button
              key={n}
              onClick={() => setColCount(n)}
              className={cn(
                'rounded px-2.5 py-0.5 text-xs transition-all',
                colCount === n
                  ? 'bg-accent text-accent-fg'
                  : 'text-content-muted hover:text-content',
              )}
              aria-pressed={colCount === n}
              title={`${n}달 보기`}
            >
              {n}달
            </button>
          ))}
        </div>
      </div>

      {/* Month columns */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {months.map(({ year: y, month: m }) => (
          <MonthGrid
            key={`${y}-${m}`}
            year={y}
            month={m}
            tasks={tasks}
            today={today}
            taskLimit={taskLimit}
            setInspecting={setInspecting}
            setPopupDate={setPopupDate}
          />
        ))}
      </div>

      {/* Day detail popup */}
      <Modal
        open={popupDate !== null}
        onClose={() => setPopupDate(null)}
        title={popupDate ? `${popupDate} 일정 (${popupTasks.length})` : '일정'}
        width={420}
      >
        <div className="flex flex-col gap-1">
          {popupTasks.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { setInspecting(t.id); setPopupDate(null); }}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface-2"
              title="상세 보기"
            >
              <span
                className="inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-sm"
                style={{ background: taskColor(t) }}
              >
                {t.isMilestone && <Diamond size={8} className="text-white" />}
              </span>
              <span className="flex-1 truncate text-content">{t.name}</span>
              <span className="shrink-0 text-2xs tabular-nums text-content-muted">
                {t.isMilestone ? t.start : `${t.start} ~ ${t.end}`}
              </span>
            </button>
          ))}
          {popupTasks.length === 0 && (
            <p className="py-4 text-center text-xs text-content-muted">일정이 없습니다.</p>
          )}
        </div>
      </Modal>
    </div>
  );
}
