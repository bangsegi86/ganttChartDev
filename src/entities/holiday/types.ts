/**
 * A non-working holiday. `substitute` marks a 대체공휴일 (substitute holiday)
 * generated when an official holiday falls on a weekend.
 */
export interface Holiday {
  /** `YYYY-MM-DD`. */
  date: string;
  name: string;
  /** True when this entry is a substitute (대체) holiday. */
  substitute: boolean;
  /** User-added holidays can be edited/removed; built-ins are seeded. */
  userDefined: boolean;
  /**
   * What kind of day off this is. Optional for files saved before it existed;
   * read it through `holidayKind()`, which derives it from the flags above.
   */
  kind?: HolidayKind;
}

export type HolidayKind = 'public' | 'substitute' | 'company' | 'other';

export const HOLIDAY_KIND_LABEL: Record<HolidayKind, string> = {
  public: '공휴일',
  substitute: '대체공휴일',
  company: '회사 휴무',
  other: '기타 휴무',
};

export function holidayKind(h: Holiday): HolidayKind {
  return h.kind ?? (h.substitute ? 'substitute' : h.userDefined ? 'company' : 'public');
}

/** Build a holiday whose legacy flags agree with its kind. */
export function makeHoliday(date: string, name: string, kind: HolidayKind): Holiday {
  return { date, name, kind, substitute: kind === 'substitute', userDefined: kind === 'company' || kind === 'other' };
}
