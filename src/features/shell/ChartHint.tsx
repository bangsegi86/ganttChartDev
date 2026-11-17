import { useState } from 'react';

const KEY = 'smart-gantt.hint.chart-drag.v1';

function readDismissed(): boolean {
  try { return window.localStorage.getItem(KEY) === '1'; } catch { return false; }
}

/**
 * One-time tip over the chart for first-time users. The button label never
 * wraps; the sentence wraps only between words when the chart is narrow.
 */
export function ChartHint() {
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed) return null;
  const close = () => {
    setDismissed(true);
    try { window.localStorage.setItem(KEY, '1'); } catch { /* private mode: show again next time */ }
  };
  return (
    <div
      role="note"
      className="pointer-events-auto absolute left-1/2 top-[72px] z-20 flex w-max max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-3 rounded-lg bg-[#1F2430] py-2 pl-4 pr-2 text-xs text-white shadow-xl"
    >
      <span className="min-w-0 leading-relaxed [word-break:keep-all]">
        막대를 끌면 날짜가 바뀌고, <b>Alt</b>를 누른 채 끌면 작업을 연결합니다. 막대를 두 번 클릭하면 자세히 고칠 수 있어요.
      </span>
      <button
        onClick={close}
        className="h-7 shrink-0 whitespace-nowrap rounded-md border border-white/30 px-3 text-xs font-semibold text-white hover:bg-white/10"
      >
        알겠어요
      </button>
    </div>
  );
}
