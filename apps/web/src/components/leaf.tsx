'use client';

import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { LeafGlyph } from './brand';

/** Leaf at work: a breathing glyph and a rotating line about what it's actually doing. */
export function LeafThinking({ steps, className }: { steps: string[]; className?: string }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % steps.length), 1600);
    return () => clearInterval(timer);
  }, [steps.length]);
  return (
    <div className={cn('flex items-center gap-3', className)} role="status" aria-live="polite">
      <span className="relative flex size-9 items-center justify-center rounded-xl bg-leaf text-leaf-foreground">
        <span className="absolute inset-0 animate-ping rounded-xl bg-leaf/40" />
        <LeafGlyph className="relative size-[18px]" />
      </span>
      <motion.span
        key={index}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-sm font-semibold text-leaf-ink"
      >
        {steps[index]}
      </motion.span>
    </div>
  );
}

/** Blinking caret appended to text that is still streaming in. */
export function StreamCaret() {
  return (
    <span
      className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[3px] animate-caret bg-leaf"
      aria-hidden
    />
  );
}

export function ConfidenceMeter({ value }: { value: number | null }) {
  if (value === null) return null;
  const pct = Math.round(value * 100);
  const tone = value >= 0.8 ? 'bg-leaf' : value >= 0.6 ? 'bg-medium' : 'bg-high';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-bold tabular-nums text-muted-foreground">
        <span className="sr-only">Leaf's confidence: </span>
        {pct}%
      </span>
    </div>
  );
}
