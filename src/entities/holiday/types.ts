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
}
