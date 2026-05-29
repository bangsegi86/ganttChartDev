import { useEffect } from 'react';
import { useProjectStore } from '@/app/store/useProjectStore';

/** Reflect the store theme onto the <html> element so CSS variables switch. */
export function useTheme(): void {
  const theme = useProjectStore((s) => s.view.theme);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
  }, [theme]);
}
