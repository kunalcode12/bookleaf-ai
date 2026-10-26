const TICKET_PREFIX = 'BL-';

export function formatTicketNumber(n: number): string {
  return `${TICKET_PREFIX}${n}`;
}

/** Returns the numeric part of "BL-1042", or null if the ref is not a ticket number. */
export function parseTicketNumber(ref: string): number | null {
  const match = /^BL-(\d{1,9})$/i.exec(ref.trim());
  return match ? Number(match[1]) : null;
}
