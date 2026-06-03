import { type ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Optional footer action area. */
  footer?: ReactNode;
  width?: number;
}

/** Accessible modal dialog with Escape-to-close and backdrop dismissal. */
export function Modal({ open, title, onClose, children, footer, width = 560 }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-dialog-in max-h-[85vh] overflow-hidden rounded-lg border border-border bg-surface shadow-2xl flex flex-col"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-content">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="닫기">
            <X size={16} />
          </Button>
        </header>
        <div className="overflow-auto p-4 text-content">{children}</div>
        {footer && (
          <footer className="flex justify-end gap-2 border-t border-border px-4 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
