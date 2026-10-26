import { SLA_HOURS, type SlaState, type TicketPriority, type TicketStatus } from '@bookleaf/contracts';
import { addHours } from './dates';

/** First-response deadline for a ticket of the given priority. */
export function slaDueAt(createdAt: Date, priority: TicketPriority): Date {
  return addHours(createdAt, SLA_HOURS[priority]);
}

export interface SlaInput {
  priority: TicketPriority | null;
  status: TicketStatus;
  createdAt: Date;
  dueAt: Date | null;
  firstResponseAt: Date | null;
}

export interface SlaResult {
  dueAt: Date | null;
  state: SlaState;
  minutesRemaining: number | null;
  targetHours: number | null;
}

/** Share of the response window left below which a ticket is flagged "at risk". */
const AT_RISK_FRACTION = 0.25;

export function computeSla(input: SlaInput, now: Date): SlaResult {
  const targetHours = input.priority ? SLA_HOURS[input.priority] : null;
  const dueAt = input.dueAt;
  if (!dueAt || !input.priority) {
    return { dueAt, state: 'pending_triage', minutesRemaining: null, targetHours };
  }
  if (input.firstResponseAt) {
    return {
      dueAt,
      state: input.firstResponseAt <= dueAt ? 'met' : 'breached',
      minutesRemaining: null,
      targetHours,
    };
  }
  if (input.status === 'resolved' || input.status === 'closed') {
    return { dueAt, state: 'paused', minutesRemaining: null, targetHours };
  }
  const remainingMs = dueAt.getTime() - now.getTime();
  const minutesRemaining = Math.round(remainingMs / 60_000);
  if (remainingMs < 0) return { dueAt, state: 'breached', minutesRemaining, targetHours };
  const windowMs = SLA_HOURS[input.priority] * 3_600_000;
  const state: SlaState = remainingMs < windowMs * AT_RISK_FRACTION ? 'at_risk' : 'on_track';
  return { dueAt, state, minutesRemaining, targetHours };
}

/** Copy shown to authors after they submit: sets expectations without exposing internal priority. */
export function expectedResponseLabel(priority: TicketPriority | null): string | null {
  if (!priority) return null;
  const hours = SLA_HOURS[priority];
  return hours >= 48 && hours % 24 === 0 ? `within ${hours / 24} days` : `within ${hours} hours`;
}
