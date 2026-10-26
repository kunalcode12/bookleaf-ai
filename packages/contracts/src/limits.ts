import type { TicketPriority } from './enums';

/** Input limits enforced identically by the web forms and the API validators. */
export const LIMITS = {
  subject: { min: 5, max: 150 },
  description: { min: 20, max: 5000 },
  message: { min: 1, max: 5000 },
  note: { min: 1, max: 2000 },
  refineInstruction: { max: 300 },
  assistQuestion: { min: 8, max: 1000 },
  feedbackComment: { max: 500 },
  kbSectionBody: { min: 20, max: 12000 },
  search: { max: 200 },
  attachments: {
    maxFiles: 5,
    maxBytes: 10 * 1024 * 1024,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as readonly string[],
  },
  pageSize: { default: 25, max: 100 },
} as const;

/** First-response targets per priority (hours). Authors see these as "we usually reply within…". */
export const SLA_HOURS: Record<TicketPriority, number> = {
  critical: 4,
  high: 12,
  medium: 24,
  low: 48,
};

/** BookLeaf royalty policy: balances below ₹1,000 roll over to the next quarter. Stored in paise. */
export const PAYOUT_THRESHOLD_MINOR = 100_000;

export const CURRENCY = 'INR' as const;
