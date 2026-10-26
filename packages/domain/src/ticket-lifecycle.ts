import { TICKET_STATUS_LABELS, type TicketStatus } from '@bookleaf/contracts';

/**
 * Ticket state machine.
 *
 *   open ─┬─► in_progress ─┬─► resolved ─┬─► closed
 *         │                 │             └─► open / in_progress (reopened)
 *         └─────────────────┴─► resolved / closed
 *
 * Closed is terminal: the conversation is archived and the author opens a new query instead.
 */
const TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ['in_progress', 'resolved', 'closed'],
  in_progress: ['open', 'resolved', 'closed'],
  resolved: ['open', 'in_progress', 'closed'],
  closed: [],
};

export class TicketLifecycleError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_STATUS_TRANSITION' | 'TICKET_CLOSED',
    readonly allowed: readonly TicketStatus[] = [],
  ) {
    super(message);
    this.name = 'TicketLifecycleError';
  }
}

export function allowedTransitions(from: TicketStatus): readonly TicketStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TicketStatus, to: TicketStatus): void {
  if (from === 'closed') {
    throw new TicketLifecycleError('This ticket is closed and can no longer change.', 'TICKET_CLOSED');
  }
  if (!canTransition(from, to)) {
    throw new TicketLifecycleError(
      `A ticket cannot move from ${TICKET_STATUS_LABELS[from]} to ${TICKET_STATUS_LABELS[to]}.`,
      'INVALID_STATUS_TRANSITION',
      TRANSITIONS[from],
    );
  }
}

/** Status after BookLeaf replies: replying starts work; "Send & resolve" resolves. */
export function statusAfterAdminReply(current: TicketStatus, resolve: boolean): TicketStatus {
  if (current === 'closed') {
    throw new TicketLifecycleError('This ticket is closed. Replies are disabled.', 'TICKET_CLOSED');
  }
  if (resolve) return 'resolved';
  return current === 'open' || current === 'resolved' ? 'in_progress' : current;
}

/** Status after the author writes again: a resolved ticket reopens and returns to the queue. */
export function statusAfterAuthorReply(current: TicketStatus): { next: TicketStatus; reopened: boolean } {
  if (current === 'closed') {
    throw new TicketLifecycleError(
      'This ticket is closed. Please open a new query and we will pick it up.',
      'TICKET_CLOSED',
    );
  }
  if (current === 'resolved') return { next: 'open', reopened: true };
  return { next: current, reopened: false };
}

export function isUnresolved(status: TicketStatus): boolean {
  return status === 'open' || status === 'in_progress';
}
