import { todayISO } from './dateUtils';

/**
 * Turn whatever a person types into a date cell into an ISO day, or explain
 * precisely why it is not a date.
 *
 * Accepted (examples for 30 Nov 2026):
 *   20261130 · 261130 · 2026-11-30 · 2026-11-5 · 2026.11.30 · 2026/11/30
 *   2026 11 30 · 2026년 11월 30일 · 11/30 · 11-30 · 11.30 · 11월 30일 · 1130
 *   오늘 · 내일 · 어제
 * When the year is omitted, `baseYear` is used (normally the year of the date
 * being edited, so editing within a project stays in that project's year).
 */
export type DateParseResult =
  | { ok: true; iso: string }
  | { ok: false; message: string };

const MIN_YEAR = 1900;
const MAX_YEAR = 2200;
const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

export function parseDateInput(raw: string, baseYear?: number): DateParseResult {
  const input = raw.trim();
  const shown = input.length > 20 ? `${input.slice(0, 20)}…` : input;
  if (!input) return { ok: false, message: '날짜가 비어 있습니다. 예: 20261130 또는 2026-11-30' };

  const rel: Record<string, number> = { 오늘: 0, 내일: 1, 어제: -1 };
  if (input in rel) return { ok: true, iso: shiftISO(todayISO(), rel[input]!) };

  const year0 = baseYear ?? Number(todayISO().slice(0, 4));
  let y: number;
  let m: number;
  let d: number;

  const digits = /^\d+$/.test(input) ? input : null;
  // "2026년 11월 30일", "11월 30일"
  const ko = /^(?:(\d{2,4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일?$/.exec(input);
  // "2026-11-30", "2026.11.30.", "2026/11/5", "2026 11 30"
  const ymd = /^(\d{4})\s*[-./\s]\s*(\d{1,2})\s*[-./\s]\s*(\d{1,2})\.?$/.exec(input);
  // "11/30", "11-30", "11.30"
  const md = /^(\d{1,2})\s*[-./]\s*(\d{1,2})\.?$/.exec(input);
  // "26-11-30", "26.11.30"
  const yymd = /^(\d{2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\.?$/.exec(input);

  if (digits && digits.length === 8) {
    y = +digits.slice(0, 4); m = +digits.slice(4, 6); d = +digits.slice(6, 8);
  } else if (digits && digits.length === 6) {
    y = 2000 + +digits.slice(0, 2); m = +digits.slice(2, 4); d = +digits.slice(4, 6);
  } else if (digits && digits.length === 4) {
    y = year0; m = +digits.slice(0, 2); d = +digits.slice(2, 4);
  } else if (ko) {
    y = ko[1] ? (ko[1].length === 2 ? 2000 + +ko[1] : +ko[1]) : year0;
    m = +ko[2]!; d = +ko[3]!;
  } else if (ymd) {
    y = +ymd[1]!; m = +ymd[2]!; d = +ymd[3]!;
  } else if (yymd) {
    y = 2000 + +yymd[1]!; m = +yymd[2]!; d = +yymd[3]!;
  } else if (md) {
    y = year0; m = +md[1]!; d = +md[2]!;
  } else {
    return {
      ok: false,
      message: `'${shown}'은(는) 날짜로 알아볼 수 없습니다. 이렇게 입력해 주세요: 20261130, 2026-11-30, 11/30`,
    };
  }

  if (y < MIN_YEAR || y > MAX_YEAR) {
    return { ok: false, message: `${y}년은 입력할 수 없습니다. ${MIN_YEAR}년부터 ${MAX_YEAR}년 사이로 입력해 주세요.` };
  }
  if (m < 1 || m > 12) {
    return { ok: false, message: `'${shown}': ${m}월은 없습니다. 월은 1부터 12까지입니다.` };
  }
  const last = daysInMonth(y, m);
  if (d < 1 || d > last) {
    return {
      ok: false,
      message: `'${shown}': ${y}년 ${m}월에는 ${d}일이 없습니다. ${m}월은 ${last}일까지 있습니다.`,
    };
  }
  return { ok: true, iso: `${y}-${pad(m)}-${pad(d)}` };
}

/** "2026-11-30(월)" — for messages. */
export function formatDayKo(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${iso}(${WEEKDAY_KO[wd]})`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function shiftISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
