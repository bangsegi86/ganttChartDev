import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Diamond } from 'lucide-react';
import { useVisibleTasks } from '@/features/view/viewFilter';
import { todayISO } from '@/shared/date/dateUtils';
import { cn } from '@/shared/ui/cn';
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

/** Returns up to `limit` tasks visible on a given ISO date, plus an overflow count. */
function tasksForDay(date: string, tasks: Task[], limit: number): { visible: Task[]; overflow: number } {
  const matching = tasks.filter((t) => !t.isMilestone && t.start <= date && t.end >= date);
  const milestones = tasks.filter((t) => t.isMilestone && t.start === date);
  const all = [...milestones, ...matching];
  return { visible: all.slice(0, limit), overflow: Math.max(0, all.length - limit) };
}

function taskColor(t: Task): string {
  return t.color ?? '#3b82f6';
}

export function CalendarMonthView() {
  const today = todayISO();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const tasks = useVisibleTasks();

  const cells = useMemo(() => buildCells(year, month), [year, month]);

  const prevMonth = () => {
    if (month === 1) { setYear((y) => y - 1); setMonth(12); }
    else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear((y) => y + 1); setMonth(1); }
    else setMonth((m) => m + 1);
  };
  const goToday = () => {
    setYear(new Date().getFullYear());
    setMonth(new Date().getMonth() + 1);
  };

  return (
    <div className="flex h-full w-full flex-1 flex-col overflow-hidden bg-surface">
      {/* Header nav */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <button
          onClick={prevMonth}
          className="rounded p-1 hover:bg-surface-2 text-content-muted"
          aria-label="이전 달"
        >
          <ChevronLeft size={16} />
        </button>
        <h2 className="min-w-[110px] text-center text-sm font-semibold text-content">
          {year}년 {month}월
        </h2>
        <button
          onClick={nextMonth}
          className="rounded p-1 hover:bg-surface-2 text-content-muted"
          aria-label="다음 달"
        >
          <ChevronRight size={16} />
        </button>
        <button
          onClick={goToday}
          className="ml-2 rounded border border-border px-2 py-0.5 text-xs text-content hover:bg-surface-2"
        >
          오늘
        </button>
      </div>

      {/* Day-of-week header */}
      <div className="grid shrink-0 grid-cols-7 border-b border-border">
        {DOW_LABELS.map((d, i) => (
          <div
            key={d}
            className={cn(
              'py-1.5 text-center text-2xs font-semibold',
              i >= 5 ? 'text-critical/70' : 'text-content-muted',
            )}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid min-h-0 flex-1 grid-cols-7 overflow-y-auto" style={{ gridAutoRows: '1fr' }}>
        {cells.map((date, idx) => {
          if (!date) {
            return <div key={`empty-${idx}`} className="border-b border-r border-border bg-surface-2/30" />;
          }
          const isToday = date === today;
          const dayNum = parseInt(date.slice(8), 10);
          const isWeekend = idx % 7 >= 5;
          const { visible, overflow } = tasksForDay(date, tasks, 3);

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
                  'mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-medium',
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
                    className="flex items-center gap-0.5 truncate rounded px-1 text-[10px] leading-[14px] text-white"
                    style={{ background: taskColor(t) }}
                    title={t.name}
                  >
                    {t.isMilestone && <Diamond size={8} className="shrink-0" />}
                    <span className="truncate">{t.name}</span>
                  </div>
                ))}
                {overflow > 0 && (
                  <span className="pl-1 text-[10px] text-content-muted">+{overflow}개</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
