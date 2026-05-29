import type { Priority } from '@/entities';

/** Bar fill colour by priority (used when a task has no explicit colour). */
export const PRIORITY_COLORS: Record<Priority, string> = {
  low: '#64748b',
  medium: '#3b82f6',
  high: '#f59e0b',
  critical: '#ef4444',
};

/** Resolve the palette for the active theme, read from CSS variables so the
 * canvas matches the DOM exactly. */
export interface CanvasPalette {
  surface: string;
  surface2: string;
  grid: string;
  gridStrong: string;
  text: string;
  textMuted: string;
  weekend: string;
  holiday: string;
  today: string;
  critical: string;
  progress: string;
  link: string;
  baseline: string;
}

function readVar(name: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw ? `rgb(${raw.split(/\s+/).join(' ')})` : '#000';
}

export function readPalette(theme: 'light' | 'dark'): CanvasPalette {
  const dark = theme === 'dark';
  return {
    surface: readVar('--color-surface'),
    surface2: readVar('--color-surface-2'),
    grid: dark ? 'rgba(148,163,184,0.12)' : 'rgba(100,116,139,0.12)',
    gridStrong: dark ? 'rgba(148,163,184,0.28)' : 'rgba(100,116,139,0.28)',
    text: readVar('--color-content'),
    textMuted: readVar('--color-content-muted'),
    weekend: dark ? 'rgba(148,163,184,0.06)' : 'rgba(100,116,139,0.06)',
    holiday: dark ? 'rgba(248,113,113,0.10)' : 'rgba(239,68,68,0.07)',
    today: dark ? '#f87171' : '#dc2626',
    critical: readVar('--color-critical'),
    progress: 'rgba(0,0,0,0.28)',
    link: dark ? '#94a3b8' : '#64748b',
    baseline: dark ? 'rgba(148,163,184,0.55)' : 'rgba(100,116,139,0.55)',
  };
}
