export interface ChartMarker {
  id: string;
  /** Display label shown above the line. */
  label: string;
  /** ISO date string (YYYY-MM-DD). */
  date: string;
  /** CSS hex color, e.g. "#e11d48". */
  color: string;
}
