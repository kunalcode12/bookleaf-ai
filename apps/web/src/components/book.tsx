import {
  PRODUCTION_STAGE_LABELS,
  PRODUCTION_STAGES,
  type ProductionInfo,
  type ProductionStage,
} from '@bookleaf/contracts';
import { Check } from 'lucide-react';
import { cn, hashString } from '@/lib/utils';

/** Cover palettes in the spirit of classic clothbound editions. */
const COVERS = [
  { cloth: '#1f4a3c', ink: '#f3e7c9', foil: '#d8b26a' },
  { cloth: '#7a2e24', ink: '#f6e6d4', foil: '#e2b36b' },
  { cloth: '#1e3557', ink: '#eef1f6', foil: '#d9b77a' },
  { cloth: '#5a3a63', ink: '#f2e8f3', foil: '#e6c27f' },
  { cloth: '#8a5a12', ink: '#fbf0d9', foil: '#f4d79a' },
  { cloth: '#2e4f52', ink: '#e6f1f0', foil: '#d6b47c' },
  { cloth: '#3a3226', ink: '#f2e9d8', foil: '#cfa45c' },
  { cloth: '#6b2c3e', ink: '#f8e7ec', foil: '#e5bd78' },
];

const SIZES = {
  sm: 'w-16 text-[7px]',
  md: 'w-28 text-[10px]',
  lg: 'w-40 text-[13px]',
  xl: 'w-52 text-[16px]',
};

/**
 * A generated clothbound cover: spine shadow, foil rules, title set in the display face. Covers are
 * deterministic per book, so every book keeps "its" colour across the portal.
 */
export function BookCover({
  title,
  author,
  stage,
  size = 'md',
  className,
}: {
  title: string;
  author?: string;
  stage?: ProductionStage;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const palette = COVERS[hashString(title) % COVERS.length]!;
  const inProduction = stage && stage !== 'published_live';
  return (
    <div
      className={cn(
        'group/cover relative aspect-[2/3] shrink-0 select-none overflow-hidden rounded-r-md rounded-l-[3px] shadow-[0_1px_1px_rgb(0_0_0/0.15),0_14px_28px_-12px_rgb(0_0_0/0.55)] transition-transform duration-300 will-change-transform',
        SIZES[size],
        className,
      )}
      style={{ backgroundColor: palette.cloth, color: palette.ink }}
      role="img"
      aria-label={`Cover of ${title}`}
    >
      {/* cloth texture + light */}
      <div
        className="absolute inset-0 opacity-[0.18] mix-blend-overlay"
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg, rgba(255,255,255,.25) 0 1px, transparent 1px 3px), repeating-linear-gradient(-45deg, rgba(0,0,0,.25) 0 1px, transparent 1px 3px)',
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-br from-white/15 via-transparent to-black/25" />
      {/* spine */}
      <div className="absolute inset-y-0 left-0 w-[7%] bg-gradient-to-r from-black/45 via-black/15 to-transparent" />
      <div className="absolute inset-y-0 left-[7%] w-px bg-white/15" />
      {/* foil frame */}
      <div
        className="absolute inset-[9%] left-[13%] rounded-[2px] border"
        style={{ borderColor: `${palette.foil}99` }}
      />
      <div className="relative flex h-full flex-col items-center justify-between px-[16%] py-[18%] text-center">
        <span className="h-[1px] w-1/3" style={{ backgroundColor: palette.foil }} />
        <span
          className="font-display font-black leading-[1.05] [overflow-wrap:anywhere]"
          style={{ fontSize: '1.45em', textShadow: '0 1px 0 rgb(0 0 0 / 0.25)' }}
        >
          {title}
        </span>
        <span className="flex flex-col items-center gap-[0.5em]">
          <span className="h-[1px] w-1/3" style={{ backgroundColor: palette.foil }} />
          {author && (
            <span
              className="font-semibold uppercase tracking-[0.18em] opacity-85"
              style={{ fontSize: '0.72em' }}
            >
              {author}
            </span>
          )}
        </span>
      </div>
      {inProduction && (
        <div
          className="absolute inset-x-0 bottom-0 bg-black/55 px-2 py-[6%] text-center font-bold uppercase tracking-[0.14em] text-white backdrop-blur-[1px]"
          style={{ fontSize: '0.7em' }}
        >
          In production
        </div>
      )}
    </div>
  );
}

/**
 * The nine BookLeaf production stages: a segmented progress bar, then the stages as a checklist
 * (three columns, so labels never collide however narrow the card is).
 */
export function ProductionTracker({
  production,
  compact = false,
}: {
  production: ProductionInfo;
  compact?: boolean;
}) {
  const current = PRODUCTION_STAGES.indexOf(production.stage);
  const state = (index: number) =>
    index < current || production.isPublished ? 'done' : index === current ? 'active' : 'todo';
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-9 gap-1.5" aria-hidden>
        {PRODUCTION_STAGES.map((stage, index) => (
          <div
            key={stage}
            className={cn(
              'h-2 rounded-full',
              state(index) === 'done'
                ? 'bg-leaf'
                : state(index) === 'active'
                  ? 'animate-leaf-pulse bg-accent'
                  : 'bg-muted',
            )}
          />
        ))}
      </div>
      {!compact && (
        <ol className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-3">
          {PRODUCTION_STAGES.map((stage, index) => {
            const s = state(index);
            return (
              <li
                key={stage}
                className="flex items-center gap-2"
                aria-current={s === 'active' ? 'step' : undefined}
              >
                <span
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                    s === 'done'
                      ? 'bg-leaf text-leaf-foreground'
                      : s === 'active'
                        ? 'bg-accent text-accent-foreground'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {s === 'done' ? <Check className="size-3" strokeWidth={3.5} /> : index + 1}
                </span>
                <span
                  className={cn(
                    'text-[13px] leading-tight',
                    s === 'active'
                      ? 'font-bold text-foreground'
                      : s === 'done'
                        ? 'font-medium text-foreground/80'
                        : 'text-muted-foreground',
                  )}
                >
                  {PRODUCTION_STAGE_LABELS[stage]}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
