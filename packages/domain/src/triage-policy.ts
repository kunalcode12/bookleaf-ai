import {
  type AiFlag,
  type PayoutStatus,
  type PolicyAdjustment,
  PRIORITY_RANK,
  type ProductionStage,
  type Sentiment,
  type TicketCategory,
  type TicketPriority,
  type TriageSignals,
} from '@bookleaf/contracts';

/** What the classifier (LLM or keyword rules) proposed for a ticket. */
export interface TriageProposal {
  category: TicketCategory;
  priority: TicketPriority;
  confidence: number;
  signals: TriageSignals;
  sentiment: Sentiment | null;
}

export interface TriagePolicyContext {
  source: 'ai' | 'rules';
  injectionFlagged: boolean;
  /** Payout status of the book the ticket is about, from BookLeaf's own records. */
  payoutStatus: PayoutStatus | null;
  bookStage: ProductionStage | null;
}

export interface TriageDecision {
  category: TicketCategory;
  priority: TicketPriority;
  flags: AiFlag[];
  adjustments: PolicyAdjustment[];
}

export const LOW_CONFIDENCE_THRESHOLD = 0.6;

const moreUrgent = (a: TicketPriority, b: TicketPriority) => PRIORITY_RANK[a] < PRIORITY_RANK[b];

/**
 * "AI proposes, policy decides." Deterministic BookLeaf rules applied after classification:
 * floors raise priority where the knowledge base mandates it, caps stop explainable situations or
 * manipulated tickets from being over-escalated. Every change is recorded with its reason so the
 * admin UI can show exactly why a priority differs from what the model said.
 */
export function applyTriagePolicy(proposal: TriageProposal, ctx: TriagePolicyContext): TriageDecision {
  const { category, signals } = proposal;
  let priority = proposal.priority;
  const adjustments: PolicyAdjustment[] = [];
  const flags = new Set<AiFlag>();

  const raise = (rule: string, floor: TicketPriority, reason: string) => {
    if (moreUrgent(floor, priority)) {
      adjustments.push({ rule, field: 'priority', from: priority, to: floor, reason });
      priority = floor;
    }
  };
  const cap = (rule: string, ceiling: TicketPriority, reason: string) => {
    if (moreUrgent(priority, ceiling)) {
      adjustments.push({ rule, field: 'priority', from: priority, to: ceiling, reason });
      priority = ceiling;
    }
  };

  // ── Floors ───────────────────────────────────────────────────────────────
  if (category === 'isbn_metadata' && signals.dataError) {
    raise(
      'isbn_error_floor',
      'high',
      'BookLeaf policy treats ISBN errors as high priority and escalates them to production.',
    );
  }
  if (category === 'printing_quality' && signals.printDefect) {
    raise(
      'print_defect_floor',
      'high',
      'Defective printed copies are a BookLeaf-side error that needs a verified reprint.',
    );
  }
  if (
    category === 'distribution_availability' &&
    signals.platformUnavailable &&
    ctx.bookStage === 'published_live'
  ) {
    raise(
      'live_book_unavailable_floor',
      'high',
      'A live book that cannot be bought is costing the author sales.',
    );
  }
  if (category === 'royalty_payments' && ctx.payoutStatus === 'attention' && signals.moneyOwed) {
    raise(
      'royalty_missed_windows_floor',
      'high',
      'Payout records show closed payout windows with no payout while the balance is above the ₹1,000 minimum.',
    );
    if ((signals.monthsWaiting ?? 0) >= 6) {
      raise(
        'royalty_long_wait',
        'critical',
        'Six months or more without royalty, consistent with the payout records.',
      );
    }
  }
  if (signals.legalThreat) {
    raise(
      'legal_threat',
      ctx.injectionFlagged ? 'high' : 'critical',
      'The author mentions legal action, a formal complaint or public escalation.',
    );
  }

  // ── Caps ─────────────────────────────────────────────────────────────────
  if (category === 'royalty_payments' && ctx.payoutStatus === 'below_threshold' && !signals.legalThreat) {
    cap(
      'below_threshold_cap',
      'medium',
      'The balance is below the ₹1,000 minimum payout, so the rollover is expected policy behaviour.',
    );
  }
  if (ctx.injectionFlagged) {
    cap(
      'manipulation_cap',
      'high',
      'The ticket contains text aimed at the AI, so Leaf will not escalate it to Critical without a human.',
    );
    flags.add('possible_injection');
    flags.add('needs_review');
  }

  if (proposal.confidence < LOW_CONFIDENCE_THRESHOLD) {
    flags.add('low_confidence');
    flags.add('needs_review');
  }
  if (ctx.source === 'rules') {
    flags.add('rule_based');
    flags.add('needs_review');
  }
  if (adjustments.length > 0) flags.add('policy_adjusted');

  return { category, priority, flags: [...flags], adjustments };
}

/** Raises only — used when an author follows up: automation may escalate, never de-escalate. */
export function escalateOnly(current: TicketPriority, proposed: TicketPriority): TicketPriority {
  return moreUrgent(proposed, current) ? proposed : current;
}
