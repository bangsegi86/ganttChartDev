import { HOLIDAY_KIND_LABEL, holidayKind, makeHoliday, type Holiday, type HolidayKind } from '@/entities';
import { parseDateInput } from '@/shared/date/parseDateInput';

/**
 * Bulk holiday input: one holiday (or a date range) per line, as typed or
 * copied from Excel. Columns: date, name, kind — separated by a tab (Excel),
 * a comma, or spaces. Examples:
 *   2026-12-25	성탄절	공휴일
 *   2026-12-24~2026-12-31, 연말 휴무, 회사
 *   10/2 임시 공휴일
 */
export type BulkStatus = 'add' | 'update' | 'same' | 'error' | 'replaced';

export interface BulkRow {
  line: number;
  text: string;
  status: BulkStatus;
  /** Holidays this line produces (several for a range). */
  holidays: Holiday[];
  message: string;
}

export interface BulkOptions {
  defaultKind: HolidayKind;
  /** Leave Saturdays and Sundays out of date ranges (they are off anyway). */
  skipWeekends: boolean;
  /** Year for dates written without one (e.g. "12/25"). */
  baseYear: number;
}

const MAX_RANGE_DAYS = 366;

const KIND_WORDS: [RegExp, HolidayKind][] = [
  [/^(대체|대체\s*공휴일|substitute)$/i, 'substitute'],
  [/^(공휴일|법정\s*공휴일|국경일|명절|public|holiday)$/i, 'public'],
  [/^(회사|회사\s*휴무|사내\s*휴무|휴무|창립\s*기념일|company)$/i, 'company'],
  [/^(기타|기타\s*휴무|other)$/i, 'other'],
];

export function parseKind(word: string): HolidayKind | null {
  const w = word.trim();
  for (const [re, k] of KIND_WORDS) if (re.test(w)) return k;
  return null;
}

export function parseHolidayBulk(text: string, existing: Holiday[], opt: BulkOptions): BulkRow[] {
  const known = new Map(existing.map((h) => [h.date, h]));
  const rows: BulkRow[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  lines.forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line) return;
    const cells = splitCells(line);
    // A header copied from Excel ("날짜  이름  유형") is skipped quietly.
    if (rows.length === 0 && /날짜|date/i.test(cells[0] ?? '') && !parseDateInput(cells[0] ?? '').ok) return;

    const row: BulkRow = { line: i + 1, text: line, status: 'error', holidays: [], message: '' };
    rows.push(row);

    const [dateCell = '', nameCell = '', kindCell = ''] = cells;
    const range = dateCell.split(/\s*~\s*/);
    if (range.length > 2) { row.message = `기간은 '시작~끝' 하나만 쓸 수 있습니다: '${dateCell}'`; return; }

    const a = parseDateInput(range[0]!, opt.baseYear);
    if (!a.ok) { row.message = a.message; return; }
    let dates = [a.iso];
    if (range.length === 2) {
      const b = parseDateInput(range[1]!, Number(a.iso.slice(0, 4)));
      if (!b.ok) { row.message = `기간의 끝 날짜: ${b.message}`; return; }
      if (b.iso < a.iso) { row.message = `기간의 끝(${b.iso})이 시작(${a.iso})보다 빠릅니다.`; return; }
      dates = expandRange(a.iso, b.iso);
      if (dates.length > MAX_RANGE_DAYS) { row.message = `기간이 너무 깁니다(${dates.length}일). 한 줄에 ${MAX_RANGE_DAYS}일까지 넣을 수 있습니다.`; return; }
      if (opt.skipWeekends) dates = dates.filter((d) => !isWeekend(d));
      if (dates.length === 0) { row.message = '기간이 모두 주말이라 넣을 날이 없습니다. (주말 빼기를 끄면 넣을 수 있습니다)'; return; }
    }

    let kind = opt.defaultKind;
    if (kindCell) {
      const k = parseKind(kindCell);
      if (!k) {
        row.message = `유형 '${kindCell}'을(를) 알 수 없습니다. 공휴일, 대체, 회사, 기타 중 하나로 쓰세요.`;
        return;
      }
      kind = k;
    }
    const name = nameCell.trim().slice(0, 60) || HOLIDAY_KIND_LABEL[kind];

    row.holidays = dates.map((d) => makeHoliday(d, name, kind));
    const changes = row.holidays.map((h) => {
      const old = known.get(h.date);
      if (!old) return 'add';
      return old.name === h.name && holidayKind(old) === h.kind ? 'same' : 'update';
    });
    const span = dates.length > 1 ? `${dates.length}일 (${dates[0]} ~ ${dates[dates.length - 1]})` : dates[0];
    const kindText = HOLIDAY_KIND_LABEL[kind];
    const nameNote = nameCell.trim() ? '' : ' · 이름이 없어 유형 이름을 씀';
    if (changes.every((c) => c === 'same')) {
      row.status = 'same';
      row.message = `${span} · 이미 같은 내용으로 있음`;
    } else if (changes.includes('update')) {
      row.status = 'update';
      const n = changes.filter((c) => c === 'update').length;
      row.message = `${span} · ${name} · ${kindText} · 기존 ${n}일의 이름/유형을 바꿈${nameNote}`;
    } else {
      row.status = 'add';
      row.message = `${span} · ${name} · ${kindText}${nameNote}`;
    }
  });

  // The same date on several lines: a single-date line beats a range (it is
  // more specific, e.g. 성탄절 inside 연말 휴무); otherwise the last line wins.
  const lastLineFor = new Map<string, number>();
  const fromSingle = new Set<string>();
  for (const r of rows) {
    const single = r.holidays.length === 1 && !r.text.includes('~');
    for (const h of r.holidays) {
      if (!single && fromSingle.has(h.date)) continue;
      lastLineFor.set(h.date, r.line);
      if (single) fromSingle.add(h.date);
    }
  }
  for (const r of rows) {
    if (r.status === 'error' || r.holidays.length === 0) continue;
    const kept = r.holidays.filter((h) => lastLineFor.get(h.date) === r.line);
    if (kept.length === 0) {
      r.status = 'replaced';
      r.message = '다른 줄에 같은 날짜가 있어 그 줄의 내용으로 넣습니다.';
    } else if (kept.length < r.holidays.length) {
      r.message += ` · ${r.holidays.length - kept.length}일은 따로 적은 줄의 내용을 따름`;
    }
    r.holidays = kept;
  }
  return rows;
}

const SPACE_KIND_WORD = /^(대체|대체공휴일|회사|사내|기타|법정|국경일|public|substitute|company|other)$/i;

function splitCells(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  if (line.includes(',')) return line.split(',').map((c) => c.trim());
  // Spaces: date (or range) first, an optional kind word last, the rest is the name.
  const m = /^(\S+(?:\s*~\s*\S+)?)\s*(.*)$/.exec(line);
  if (!m) return [line];
  const rest = m[2]!.trim();
  const words = rest.split(/\s+/);
  const last = words[words.length - 1] ?? '';
  // Only unmistakable kind words count here: "임시 공휴일" or "연말 휴무" are names.
  if (words.length > 1 && SPACE_KIND_WORD.test(last)) return [m[1]!, words.slice(0, -1).join(' '), last];
  return [m[1]!, rest];
}

function expandRange(a: string, b: string): string[] {
  const out: string[] = [];
  const end = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  for (let t = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)); t <= end && out.length <= MAX_RANGE_DAYS; t += 864e5) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function isWeekend(iso: string): boolean {
  const wd = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))).getUTCDay();
  return wd === 0 || wd === 6;
}

/** A ready-to-fill template for Excel (tab-separated). */
export const HOLIDAY_TEMPLATE = [
  '날짜\t이름\t유형',
  '2026-12-25\t성탄절\t공휴일',
  '2026-10-02\t임시 공휴일\t공휴일',
  '2026-04-15\t창립기념일\t회사',
  '2026-12-29~2026-12-31\t연말 휴무\t회사',
].join('\n');
