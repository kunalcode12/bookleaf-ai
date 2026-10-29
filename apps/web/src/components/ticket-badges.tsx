import {
  type ClassificationSource,
  type SlaView,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from '@bookleaf/contracts';
import {
  Barcode,
  BookOpen,
  CircleCheck,
  CircleDashed,
  Clock,
  Flame,
  IndianRupee,
  Lock,
  MessageSquare,
  Printer,
  Truck,
  UserCheck,
} from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/primitives';
import { slaDisplay } from '@/lib/format';
import { cn } from '@/lib/utils';
import { LeafGlyph } from './brand';

const STATUS_TONE: Record<TicketStatus, BadgeTone> = {
  open: 'accent',
  in_progress: 'info',
  resolved: 'success',
  closed: 'neutral',
};

const STATUS_ICON: Record<TicketStatus, typeof Clock> = {
  open: CircleDashed,
  in_progress: Clock,
  resolved: CircleCheck,
  closed: Lock,
};

export function StatusBadge({ status, size = 'md' }: { status: TicketStatus; size?: 'sm' | 'md' | 'lg' }) {
  const Icon = STATUS_ICON[status];
  return (
    <Badge tone={STATUS_TONE[status]} size={size}>
      <Icon />
      {TICKET_STATUS_LABELS[status]}
    </Badge>
  );
}

export const PRIORITY_TONE: Record<TicketPriority, BadgeTone> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

export const PRIORITY_BAR: Record<TicketPriority, string> = {
  critical: 'bg-critical',
  high: 'bg-high',
  medium: 'bg-medium',
  low: 'bg-low',
};

const SOURCE_LABEL: Record<ClassificationSource, string> = {
  ai: 'Set by Leaf',
  rules: 'Set by keyword rules (AI unavailable)',
  admin: 'Set by the BookLeaf team',
};

function SourceMark({ source }: { source: ClassificationSource | null }) {
  if (!source) return null;
  return (
    <Tooltip content={SOURCE_LABEL[source]}>
      <span className="ml-0.5 inline-flex items-center opacity-80">
        {source === 'ai' ? (
          <LeafGlyph className="size-3" />
        ) : source === 'admin' ? (
          <UserCheck className="!size-3" />
        ) : (
          <span className="text-[9px] font-black tracking-wider">RULES</span>
        )}
      </span>
    </Tooltip>
  );
}

export function PriorityBadge({
  priority,
  source,
  size = 'md',
}: {
  priority: TicketPriority | null;
  source?: ClassificationSource | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  if (!priority) {
    return (
      <Badge tone="outline" size={size}>
        Untriaged
      </Badge>
    );
  }
  return (
    <Badge tone={PRIORITY_TONE[priority]} size={size}>
      {priority === 'critical' && <Flame />}
      {TICKET_PRIORITY_LABELS[priority]}
      <SourceMark source={source ?? null} />
    </Badge>
  );
}

const CATEGORY_ICON: Record<TicketCategory, typeof Clock> = {
  royalty_payments: IndianRupee,
  isbn_metadata: Barcode,
  printing_quality: Printer,
  distribution_availability: Truck,
  book_status_production: BookOpen,
  general_inquiry: MessageSquare,
};

export function CategoryBadge({
  category,
  source,
  size = 'md',
  className,
}: {
  category: TicketCategory | null;
  source?: ClassificationSource | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  if (!category) {
    return (
      <Badge tone="outline" size={size} className={className}>
        Being routed…
      </Badge>
    );
  }
  const Icon = CATEGORY_ICON[category];
  return (
    <Badge tone="neutral" size={size} className={className}>
      <Icon />
      {TICKET_CATEGORY_LABELS[category]}
      <SourceMark source={source ?? null} />
    </Badge>
  );
}

export function CategoryIcon({ category, className }: { category: TicketCategory; className?: string }) {
  const Icon = CATEGORY_ICON[category];
  return <Icon className={className} />;
}

const SLA_TONES = {
  critical: 'text-critical bg-critical-soft',
  warning: 'text-warning bg-warning-soft',
  success: 'text-success bg-success-soft',
  neutral: 'text-muted-foreground bg-muted',
  leaf: 'text-leaf-ink bg-leaf-soft',
};

export function SlaChip({ sla, className }: { sla: SlaView; className?: string }) {
  const { label, tone } = slaDisplay(sla);
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-semibold tabular-nums',
        SLA_TONES[tone],
        className,
      )}
    >
      <Clock className="size-3.5" />
      {label}
    </span>
  );
}
