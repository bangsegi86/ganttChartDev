import { create } from 'zustand';
import { useEffect, useRef } from 'react';
import { Button } from './Button';

/**
 * Promise-based choice dialog: `const pick = await askChoice({...})` returns the
 * chosen option's `value`, or `null` when the user cancels (Esc, backdrop or
 * the cancel button). Mount `<ChoiceDialogHost />` once at the app root.
 */
export interface ChoiceOption {
  value: string;
  label: string;
  /** Short explanation under the label. */
  hint?: string;
  /** Highlight as the suggested choice (also focused first). */
  primary?: boolean;
}

export interface ChoiceRequest {
  title: string;
  message: string;
  options: ChoiceOption[];
  cancelLabel?: string;
}

interface ChoiceState {
  request: ChoiceRequest | null;
  resolve: ((v: string | null) => void) | null;
}

const useChoiceStore = create<ChoiceState>(() => ({ request: null, resolve: null }));

export function askChoice(request: ChoiceRequest): Promise<string | null> {
  return new Promise((resolve) => {
    // A still-open request is answered "cancel" before showing the new one.
    useChoiceStore.getState().resolve?.(null);
    useChoiceStore.setState({ request, resolve });
  });
}

function answer(value: string | null): void {
  const { resolve } = useChoiceStore.getState();
  useChoiceStore.setState({ request: null, resolve: null });
  resolve?.(value);
}

export function ChoiceDialogHost() {
  const request = useChoiceStore((s) => s.request);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!request) return;
    primaryRef.current?.focus();
    // Capture phase so grid/global shortcuts don't act while the dialog is open.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        answer(null);
      } else if (e.key !== 'Tab' && e.key !== 'Enter' && e.key !== ' ') {
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [request]);

  if (!request) return null;
  const firstPrimary = request.options.findIndex((o) => o.primary);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      onMouseDown={() => answer(null)}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="choice-title"
        className="w-[440px] max-w-[92vw] rounded-xl border border-border bg-surface-2 p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="choice-title" className="text-sm font-semibold text-content">{request.title}</h2>
        <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-content-muted">{request.message}</p>
        <div className="mt-4 flex flex-col gap-2">
          {request.options.map((o, i) => (
            <button
              key={o.value}
              ref={i === (firstPrimary >= 0 ? firstPrimary : 0) ? primaryRef : undefined}
              onClick={() => answer(o.value)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-accent/60 ${
                o.primary
                  ? 'border-accent/50 bg-accent/10 hover:bg-accent/15'
                  : 'border-border bg-surface hover:bg-surface-3'
              }`}
            >
              <div className={`text-xs font-semibold ${o.primary ? 'text-accent' : 'text-content'}`}>{o.label}</div>
              {o.hint && <div className="mt-0.5 text-2xs text-content-muted">{o.hint}</div>}
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button size="sm" onClick={() => answer(null)}>{request.cancelLabel ?? '취소'}</Button>
        </div>
      </div>
    </div>
  );
}
