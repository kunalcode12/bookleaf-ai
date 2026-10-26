import type { TicketPriority, TicketStatus } from '@bookleaf/contracts';

/**
 * 0–100 urgency used to order the queue. Priority sets the base; age and a missed response
 * deadline push older tickets up so nothing starves at the bottom of its priority band.
 *
 * Keep in sync with `urgencySql` in the API's ticket repository (same formula, evaluated in SQL
 * so the database can sort and paginate by it).
 */
export const URGENCY_BASE: Record<TicketPriority | 'untriaged', number> = {
  critical: 80,
  high: 60,
  medium: 40,
  low: 20,
  untriaged: 50,
};
export const URGENCY_AGE_STEP_HOURS = 6;
export const URGENCY_MAX_AGE_BOOST = 12;
export const URGENCY_BREACH_BOOST = 8;

export interface UrgencyInput {
  priority: TicketPriority | null;
  status: TicketStatus;
  createdAt: Date;
  slaDueAt: Date | null;
  firstResponseAt: Date | null;
}

export function urgencyScore(input: UrgencyInput, now: Date): number {
  if (input.status === 'resolved' || input.status === 'closed') return 0;
  const base = URGENCY_BASE[input.priority ?? 'untriaged'];
  const ageHours = Math.max(0, (now.getTime() - input.createdAt.getTime()) / 3_600_000);
  const ageBoost = Math.min(URGENCY_MAX_AGE_BOOST, Math.floor(ageHours / URGENCY_AGE_STEP_HOURS));
  const breached = !input.firstResponseAt && input.slaDueAt !== null && now > input.slaDueAt;
  return Math.min(100, base + ageBoost + (breached ? URGENCY_BREACH_BOOST : 0));
}
