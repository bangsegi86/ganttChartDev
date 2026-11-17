import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * App-wide tooltip layer.
 *
 * Any element can opt in with data attributes — no wrapper component needed:
 *   data-tip="제목"  data-tip-desc="한두 문장 설명"  data-tip-keys="Ctrl+S"
 *
 * It appears quickly (unlike the browser's native `title`), can carry a short
 * explanation and the keyboard shortcut, and stays inside the window.
 */
interface TipState {
  title: string;
  desc: string | null;
  keys: string | null;
  rect: DOMRect;
}

const SHOW_DELAY_MS = 350;

export function TooltipLayer() {
  const [tip, setTip] = useState<TipState | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let current: HTMLElement | null = null;

    const hide = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      current = null;
      setTip(null);
      setPos(null);
    };

    const onOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-tip]');
      if (el === current) return;
      hide();
      if (!el) return;
      current = el;
      timer = setTimeout(() => {
        if (!current || !document.body.contains(current)) return;
        setTip({
          title: current.dataset.tip ?? '',
          desc: current.dataset.tipDesc ?? null,
          keys: current.dataset.tipKeys ?? null,
          rect: current.getBoundingClientRect(),
        });
      }, SHOW_DELAY_MS);
    };

    window.addEventListener('mouseover', onOver);
    window.addEventListener('mousedown', hide, true);
    window.addEventListener('keydown', hide, true);
    window.addEventListener('wheel', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      hide();
      window.removeEventListener('mouseover', onOver);
      window.removeEventListener('mousedown', hide, true);
      window.removeEventListener('keydown', hide, true);
      window.removeEventListener('wheel', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Place below the element (above if no room), clamped to the viewport.
  useEffect(() => {
    if (!tip || !boxRef.current) return;
    const box = boxRef.current.getBoundingClientRect();
    const margin = 8;
    let left = tip.rect.left + tip.rect.width / 2 - box.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - box.width - margin));
    let top = tip.rect.bottom + 6;
    if (top + box.height > window.innerHeight - margin) top = tip.rect.top - box.height - 6;
    setPos({ left, top: Math.max(margin, top) });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={boxRef}
      role="tooltip"
      style={{ position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, zIndex: 10000 }}
      className="pointer-events-none max-w-[280px] rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-content shadow-xl"
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold">{tip.title}</span>
        {tip.keys && (
          <kbd className="ml-auto rounded border border-border bg-surface-2 px-1 py-px font-mono text-2xs text-content-muted">
            {tip.keys}
          </kbd>
        )}
      </div>
      {tip.desc && <p className="mt-0.5 leading-snug text-content-muted">{tip.desc}</p>}
    </div>,
    document.body,
  );
}

/** Spread onto any element: `<button {...tipProps('저장', '설명', 'Ctrl+S')}>` */
export function tipProps(title: string, desc?: string, keys?: string): Record<string, string> {
  const p: Record<string, string> = { 'data-tip': title, 'aria-label': title };
  if (desc) p['data-tip-desc'] = desc;
  if (keys) p['data-tip-keys'] = keys;
  return p;
}
