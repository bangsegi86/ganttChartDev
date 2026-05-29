import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

type Variant = 'default' | 'ghost' | 'accent' | 'danger';
type Size = 'sm' | 'md' | 'icon';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  active?: boolean;
}

const variants: Record<Variant, string> = {
  default:
    'bg-surface-2 text-content border border-border hover:bg-surface-3',
  ghost: 'text-content hover:bg-surface-3',
  accent: 'bg-accent text-accent-fg hover:opacity-90',
  danger: 'bg-critical text-white hover:opacity-90',
};

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2 text-xs gap-1',
  md: 'h-9 px-3 text-sm gap-1.5',
  icon: 'h-8 w-8 justify-center',
};

/** Reusable, theme-aware button used across the toolbar and dialogs. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'default', size = 'md', active, className, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center rounded-md font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none select-none',
        variants[variant],
        sizes[size],
        active && 'ring-2 ring-accent',
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
