import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

const fieldBase =
  'w-full rounded-xl border border-input bg-card px-3.5 text-[15px] text-foreground shadow-[0_1px_0_rgb(0_0_0/0.02)_inset] outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/70 focus-visible:border-foreground/40 focus-visible:ring-4 focus-visible:ring-foreground/8 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger aria-invalid:ring-danger/15';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(fieldBase, 'h-11', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea className={cn(fieldBase, 'min-h-28 resize-y py-3 leading-relaxed', className)} {...props} />
  );
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  // biome-ignore lint/a11y/noLabelWithoutControl: htmlFor is passed through props
  return <label className={cn('text-sm font-semibold text-foreground', className)} {...props} />;
}

/** Label + control + hint/error, wired for screen readers. */
export function Field({
  id,
  label,
  hint,
  error,
  counter,
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  counter?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {counter && <span className="text-xs tabular-nums text-muted-foreground">{counter}</span>}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[13px] font-medium text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[13px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
