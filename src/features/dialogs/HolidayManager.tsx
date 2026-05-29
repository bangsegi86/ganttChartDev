import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui/Button';
import { useProjectStore } from '@/app/store/useProjectStore';
import { generateKoreanHolidays } from '@/services/holiday/koreanHolidays';

/** Add/remove holidays and regenerate Korean public holidays for a year range. */
export function HolidayManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const holidays = useProjectStore((s) => s.derived.project.holidays);
  const upsertHoliday = useProjectStore((s) => s.upsertHoliday);
  const removeHoliday = useProjectStore((s) => s.removeHoliday);

  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [fromYear, setFromYear] = useState(new Date().getFullYear());
  const [toYear, setToYear] = useState(new Date().getFullYear() + 1);

  const add = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name.trim()) return;
    upsertHoliday({ date, name: name.trim(), substitute: false, userDefined: true });
    setDate('');
    setName('');
  };

  const regenerate = () => {
    const generated = generateKoreanHolidays(Math.min(fromYear, toYear), Math.max(fromYear, toYear));
    // Preserve user-defined entries, replace the built-in set.
    const userDefined = holidays.filter((h) => h.userDefined);
    for (const h of generated) upsertHoliday(h);
    for (const h of userDefined) upsertHoliday(h);
  };

  return (
    <Modal open={open} onClose={onClose} title="공휴일 관리" width={560}>
      <div className="mb-3 flex items-end gap-2">
        <label className="flex flex-col text-2xs text-content-muted">
          날짜
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-0.5 h-8 rounded border border-border bg-surface px-2 text-xs text-content"
          />
        </label>
        <label className="flex flex-1 flex-col text-2xs text-content-muted">
          이름
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 창립기념일"
            className="mt-0.5 h-8 rounded border border-border bg-surface px-2 text-xs text-content"
          />
        </label>
        <Button size="sm" variant="accent" onClick={add}>
          추가
        </Button>
      </div>

      <div className="mb-3 flex items-end gap-2 rounded border border-border bg-surface-2 p-2">
        <label className="flex flex-col text-2xs text-content-muted">
          시작 연도
          <input
            type="number"
            value={fromYear}
            onChange={(e) => setFromYear(Number(e.target.value))}
            className="mt-0.5 h-8 w-24 rounded border border-border bg-surface px-2 text-xs text-content"
          />
        </label>
        <label className="flex flex-col text-2xs text-content-muted">
          종료 연도
          <input
            type="number"
            value={toYear}
            onChange={(e) => setToYear(Number(e.target.value))}
            className="mt-0.5 h-8 w-24 rounded border border-border bg-surface px-2 text-xs text-content"
          />
        </label>
        <Button size="sm" onClick={regenerate}>
          대한민국 공휴일 생성
        </Button>
      </div>

      <div className="max-h-72 overflow-auto rounded border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface-2 text-content-muted">
            <tr>
              <th className="p-2 text-left">날짜</th>
              <th className="p-2 text-left">이름</th>
              <th className="p-2 text-center">유형</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {holidays.map((h) => (
              <tr key={h.date} className="border-t border-border">
                <td className="p-2 text-content">{h.date}</td>
                <td className="p-2 text-content">{h.name}</td>
                <td className="p-2 text-center text-content-muted">
                  {h.substitute ? '대체' : h.userDefined ? '사용자' : '공휴일'}
                </td>
                <td className="p-2 text-right">
                  <button onClick={() => removeHoliday(h.date)} aria-label="삭제" className="text-content-muted hover:text-critical">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {holidays.length === 0 && (
              <tr>
                <td colSpan={4} className="p-4 text-center text-content-muted">
                  등록된 공휴일이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
