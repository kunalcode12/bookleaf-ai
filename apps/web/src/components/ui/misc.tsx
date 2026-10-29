import type { ComponentProps, ReactNode } from 'react';
import { cn, hashString, initials } from '@/lib/utils';

export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('skeleton rounded-lg', className)} aria-hidden {...props} />;
}

export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-b-2 bg-card px-1 font-sans text-[11px] font-semibold text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

const AVATAR_TONES = [
  'bg-[#2d6a4d] text-[#eef7f1]',
  'bg-[#8a3b2e] text-[#fbefe9]',
  'bg-[#2b4c7e] text-[#eaf0f9]',
  'bg-[#7a5a12] text-[#fbf3e1]',
  'bg-[#5b3f73] text-[#f3ecf9]',
  'bg-[#3d5a5a] text-[#e9f3f3]',
];

export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const tone = AVATAR_TONES[hashString(name) % AVATAR_TONES.length];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-display font-bold ring-2 ring-card',
        size === 'sm' && 'size-6 text-[10px]',
        size === 'md' && 'size-8 text-xs',
        size === 'lg' && 'size-11 text-base',
        tone,
        className,
      )}
      title={name}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/** Big editorial page title used at the top of every screen. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-col gap-5 md:flex-row md:items-end md:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-4xl font-black leading-[0.95] sm:text-5xl md:text-[3.6rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
