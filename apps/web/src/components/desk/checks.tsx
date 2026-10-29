import type { DraftCheck, ToneChecklist } from '@bookleaf/contracts';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

const SEVERITY = {
  ok: { icon: CircleCheck, className: 'text-success' },
  info: { icon: Info, className: 'text-info' },
  warning: { icon: TriangleAlert, className: 'text-warning' },
  error: { icon: CircleAlert, className: 'text-danger' },
} as const;

export function CheckList({ checks, limit }: { checks: DraftCheck[]; limit?: number }) {
  // The same verified amount can appear several times in a reply; list it once.
  const seen = new Set<string>();
  const unique = checks.filter((c) => {
    if (c.severity === 'ok' && c.kind !== 'fact') return false;
    const key = `${c.kind}|${c.severity}|${c.text ?? c.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const shown = limit ? unique.slice(0, limit) : unique;
  if (shown.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {shown.map((check) => {
        const { icon: Icon, className } = SEVERITY[check.severity];
        return (
          <li
            key={`${check.kind}|${check.severity}|${check.text ?? check.message}`}
            className="flex gap-2 text-[13px] leading-snug"
          >
            <Icon className={cn('mt-0.5 size-3.5 shrink-0', className)} />
            <span>
              {check.text && (
                <span className="mr-1 rounded bg-muted px-1 font-mono text-[12px]">{check.text}</span>
              )}
              <span className="text-foreground/85">{check.message}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const TONE_ITEMS: Array<{ key: keyof ToneChecklist; label: string }> = [
  { key: 'acknowledges', label: 'Acknowledges' },
  { key: 'specific', label: 'Specific' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'nextStep', label: 'Next step' },
  { key: 'noFluff', label: 'No fluff' },
];

/** BookLeaf's tone guide as a checklist. */
export function ToneChecks({ checklist }: { checklist: ToneChecklist }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {TONE_ITEMS.map(({ key, label }) => (
        <span
          key={key}
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold',
            checklist[key]
              ? 'bg-success-soft text-success'
              : 'bg-muted text-muted-foreground line-through decoration-1',
          )}
        >
          {checklist[key] && <CircleCheck className="size-3" />}
          {label}
        </span>
      ))}
    </div>
  );
}
