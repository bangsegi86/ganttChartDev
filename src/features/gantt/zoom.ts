/**
 * Timeline zoom tiers. Each tier defines the pixel width of a single day and
 * which header bands to draw. The renderer multiplies day offsets by
 * `dayWidth` to position bars, so zooming is just a scalar change.
 */
export type ZoomLevel = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface ZoomConfig {
  level: ZoomLevel;
  /** Pixels per calendar day. */
  dayWidth: number;
  /** Top header granularity. */
  major: 'day' | 'week' | 'month' | 'quarter' | 'year';
  /** Bottom header granularity. */
  minor: 'hour' | 'day' | 'week' | 'month';
}

export const ZOOM_CONFIGS: Record<ZoomLevel, ZoomConfig> = {
  hour: { level: 'hour', dayWidth: 240, major: 'day', minor: 'hour' },
  day: { level: 'day', dayWidth: 40, major: 'month', minor: 'day' },
  week: { level: 'week', dayWidth: 18, major: 'month', minor: 'week' },
  month: { level: 'month', dayWidth: 6, major: 'quarter', minor: 'month' },
  quarter: { level: 'quarter', dayWidth: 2.2, major: 'year', minor: 'month' },
  year: { level: 'year', dayWidth: 0.9, major: 'year', minor: 'month' },
};

export const ZOOM_ORDER: ZoomLevel[] = ['year', 'quarter', 'month', 'week', 'day', 'hour'];

/** Step the zoom in (`+1`) or out (`-1`), clamped to the available tiers. */
export function stepZoom(current: ZoomLevel, direction: 1 | -1): ZoomLevel {
  const idx = ZOOM_ORDER.indexOf(current);
  const next = Math.min(ZOOM_ORDER.length - 1, Math.max(0, idx + direction));
  return ZOOM_ORDER[next]!;
}
