import { Modal } from '@/shared/ui/Modal';
import { useProjectStore } from '@/app/store/useProjectStore';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** Configure the working calendar: working days, holiday exclusion and mode. */
export function CalendarSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const calendar = useProjectStore((s) => s.derived.project.calendar);
  const setCalendar = useProjectStore((s) => s.setCalendar);

  const toggleDay = (day: number) => {
    const set = new Set(calendar.workingWeekdays);
    if (set.has(day)) set.delete(day);
    else set.add(day);
    setCalendar({ workingWeekdays: [...set].sort() });
  };

  return (
    <Modal open={open} onClose={onClose} title="달력 설정" width={480}>
      <div className="space-y-4 text-sm text-content">
        <div>
          <p className="mb-2 text-2xs font-semibold text-content-muted">작업 요일</p>
          <div className="flex gap-1">
            {WEEKDAYS.map((label, i) => (
              <button
                key={i}
                onClick={() => toggleDay(i)}
                className={`h-9 w-9 rounded-md border text-xs transition-all active:scale-95 ${
                  calendar.workingWeekdays.includes(i)
                    ? 'border-accent bg-accent text-accent-fg'
                    : 'border-border bg-surface-2 text-content-muted hover:border-accent/50 hover:text-content'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center justify-between">
          <span>공휴일 제외</span>
          <input
            type="checkbox"
            checked={calendar.excludeHolidays}
            onChange={(e) => setCalendar({ excludeHolidays: e.target.checked })}
            className="h-4 w-4 accent-[rgb(var(--color-accent))]"
          />
        </label>

        <div>
          <p className="mb-2 text-2xs font-semibold text-content-muted">기간 계산 기준</p>
          <div className="flex gap-2">
            <ModeButton
              active={calendar.mode === 'working'}
              label="실제 작업일"
              onClick={() => setCalendar({ mode: 'working' })}
            />
            <ModeButton
              active={calendar.mode === 'calendar'}
              label="캘린더 일수"
              onClick={() => setCalendar({ mode: 'calendar' })}
            />
          </div>
        </div>

        <label className="flex items-center justify-between">
          <span>1일 작업 시간</span>
          <input
            type="number"
            min={1}
            max={24}
            value={calendar.hoursPerDay}
            onChange={(e) => setCalendar({ hoursPerDay: Number(e.target.value) || 8 })}
            className="h-8 w-20 rounded border border-border bg-surface px-2 text-xs text-content outline-none transition-colors focus:border-accent"
          />
        </label>
      </div>
    </Modal>
  );
}

function ModeButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-md border px-3 py-2 text-xs transition-all active:scale-[0.97] ${
        active ? 'border-accent bg-accent text-accent-fg' : 'border-border bg-surface-2 text-content-muted hover:border-accent/50 hover:text-content'
      }`}
    >
      {label}
    </button>
  );
}
