import { cn } from '@/lib/utils';

/** The BookLeaf mark: an open book whose right page curls into a leaf. */
export function BookLeafMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn('size-8', className)} aria-hidden>
      <rect width="40" height="40" rx="11" className="fill-primary" />
      <path
        d="M9 12.5c3.6-1.2 7.4-.9 11 1.4v15c-3.6-2.3-7.4-2.6-11-1.4z"
        className="fill-primary-foreground/90"
      />
      <path d="M20 13.9c2.6-3.3 6.6-5 11-4.9.3 6.9-2.7 13.6-11 19.9z" className="fill-[var(--accent)]" />
      <path
        d="M20.6 26.6c2.3-4.3 4.9-8.1 8.2-11.4"
        className="stroke-primary/70"
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BookLeafLogo({ className, subtitle }: { className?: string; subtitle?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <BookLeafMark />
      <span className="flex flex-col leading-none">
        <span className="font-display text-[1.35rem] font-black tracking-tight">BookLeaf</span>
        {subtitle && (
          <span className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            {subtitle}
          </span>
        )}
      </span>
    </span>
  );
}

/** Leaf — BookLeaf's support intelligence. Its own mark, so AI output is always recognisable. */
export function LeafGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('size-4', className)} aria-hidden>
      <path
        d="M20.5 3.5c-8.6-.4-15.4 3.9-16.8 11.1-.5 2.6.3 4.8 1.9 5.9 4.8-6.6 8.3-9.2 11.6-11.1-3.6 3-6.3 6.4-9.1 11 7.5 1.3 13.1-5.2 12.4-16.9z"
        fill="currentColor"
      />
    </svg>
  );
}

export function LeafBadge({ className, label = 'Leaf' }: { className?: string; label?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-leaf px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-leaf-foreground',
        className,
      )}
    >
      <LeafGlyph className="size-3.5" />
      {label}
    </span>
  );
}
