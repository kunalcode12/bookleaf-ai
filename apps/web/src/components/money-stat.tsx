import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A big hand-set figure with a small label: the portal's signature "ledger" tile. */
export function StatTile({
  label,
  value,
  sub,
  icon,
  tone = 'default',
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'accent' | 'leaf' | 'ink';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl p-5',
        tone === 'default' && 'paper',
        tone === 'accent' && 'bg-accent-soft text-accent-ink ring-1 ring-accent/20',
        tone === 'leaf' && 'bg-leaf-soft text-leaf-ink ring-1 ring-leaf/20',
        tone === 'ink' && 'bg-primary text-primary-foreground shadow-lift',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p
          className={cn(
            'text-[11px] font-bold uppercase tracking-[0.16em]',
            tone === 'default' ? 'text-muted-foreground' : 'opacity-80',
          )}
        >
          {label}
        </p>
        {icon && <span className="opacity-70 [&_svg]:size-[18px]">{icon}</span>}
      </div>
      <p className="figure mt-3 text-[2.35rem] font-black leading-none">{value}</p>
      {sub && (
        <div
          className={cn(
            'mt-2.5 text-[13px] leading-snug',
            tone === 'default' ? 'text-muted-foreground' : 'opacity-85',
          )}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
