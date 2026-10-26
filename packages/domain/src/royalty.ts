import { PAYOUT_THRESHOLD_MINOR, type PayoutStatus, type ProductionStage } from '@bookleaf/contracts';
import {
  addDays,
  type CalendarQuarter,
  formatLongDate,
  nextQuarter,
  parseIsoDate,
  previousQuarter,
  quarterEnd,
  quarterLabel,
  quarterOf,
  startOfUtcDay,
  toIsoDate,
} from './dates';
import { formatInr } from './money';

/** BookLeaf royalty policy: calculated quarterly, paid within 45 days of the quarter ending. */
export const PAYOUT_WINDOW_DAYS = 45;

export interface PayoutWindow {
  quarter: CalendarQuarter;
  quarterEnd: Date;
  /** Last day the payout for this quarter is due. */
  deadline: Date;
  periodLabel: string;
}

export function payoutWindow(quarter: CalendarQuarter): PayoutWindow {
  const end = quarterEnd(quarter);
  return {
    quarter,
    quarterEnd: end,
    deadline: addDays(end, PAYOUT_WINDOW_DAYS),
    periodLabel: quarterLabel(quarter),
  };
}

/** The quarter that contains `date`. */
function quarterContaining(date: Date): CalendarQuarter {
  return quarterOf(startOfUtcDay(date));
}

/** The most recent quarter that has fully ended before `today`. */
export function lastCompletedQuarter(today: Date): CalendarQuarter {
  return previousQuarter(quarterContaining(today));
}

/**
 * The payout an author should expect next, seen from `today`: the window for the last completed
 * quarter if it is still open, otherwise the window for the quarter currently running.
 */
export function nextPayoutWindow(today: Date): PayoutWindow {
  const day = startOfUtcDay(today);
  const window = payoutWindow(lastCompletedQuarter(day));
  return window.deadline >= day ? window : payoutWindow(quarterContaining(day));
}

/** Payout windows that closed (deadline passed) for quarters from `firstQuarter` up to `today`. */
export function closedWindowsFrom(firstQuarter: CalendarQuarter, today: Date): PayoutWindow[] {
  const day = startOfUtcDay(today);
  const closed: PayoutWindow[] = [];
  let quarter = firstQuarter;
  for (let i = 0; i < 400; i += 1) {
    const window = payoutWindow(quarter);
    if (window.deadline >= day) break;
    closed.push(window);
    quarter = nextQuarter(quarter);
  }
  return closed;
}

export interface PayoutInput {
  stage: ProductionStage;
  publicationDate: string | null;
  earnedMinor: number;
  paidMinor: number;
  pendingMinor: number;
  lastPayoutDate: string | null;
}

export interface PayoutComputation {
  status: PayoutStatus;
  lastPayoutDate: string | null;
  nextPayoutDate: string | null;
  nextPayoutPeriod: string | null;
  missedWindows: number;
  /** Deadlines of the windows that passed without a payout, oldest first. */
  missedWindowDates: string[];
  belowThreshold: boolean;
  thresholdMinor: number;
  message: string;
}

/**
 * Applies the royalty policy to one book's ledger. The output is deterministic and is what Leaf
 * receives as facts — the language model never does date math itself.
 *
 * "attention" means a payout window has closed since the last recorded payout (or since
 * publication, if never paid) while the balance is above the ₹1,000 minimum. The data cannot tell
 * us *which* quarter the pending balance accrued in, so this is phrased as "needs checking", not
 * as a confirmed late payment.
 */
export function computePayout(input: PayoutInput, today: Date): PayoutComputation {
  const next = nextPayoutWindow(today);
  const base = {
    lastPayoutDate: input.lastPayoutDate,
    nextPayoutDate: null as string | null,
    nextPayoutPeriod: null as string | null,
    missedWindows: 0,
    missedWindowDates: [] as string[],
    belowThreshold: false,
    thresholdMinor: PAYOUT_THRESHOLD_MINOR,
  };
  const withNext = { ...base, nextPayoutDate: toIsoDate(next.deadline), nextPayoutPeriod: next.periodLabel };

  if (input.stage !== 'published_live') {
    return {
      ...base,
      status: 'not_applicable',
      message: 'Royalties begin once the book is published and live.',
    };
  }
  if (input.earnedMinor <= 0) {
    return {
      ...withNext,
      status: 'no_sales',
      message:
        'No royalties have been earned yet. Royalties are calculated every quarter once sales come in.',
    };
  }
  if (input.pendingMinor <= 0) {
    return {
      ...base,
      status: 'settled',
      message: input.lastPayoutDate
        ? `All royalties earned so far have been paid. The last payout was on ${formatLongDate(input.lastPayoutDate)}.`
        : 'All royalties earned so far have been paid.',
    };
  }

  const pending = formatInr(input.pendingMinor);
  if (input.pendingMinor < PAYOUT_THRESHOLD_MINOR) {
    return {
      ...withNext,
      status: 'below_threshold',
      belowThreshold: true,
      message: `${pending} is below the ${formatInr(PAYOUT_THRESHOLD_MINOR)} minimum payout, so it rolls over to the next quarter until the balance reaches the minimum.`,
    };
  }

  // A payout made during quarter Q settles the quarter before it, so Q itself is the first quarter
  // whose earnings are still owed. For a book never paid, that is its publication quarter.
  const firstQuarter = input.lastPayoutDate
    ? quarterContaining(parseIsoDate(input.lastPayoutDate))
    : input.publicationDate
      ? quarterContaining(parseIsoDate(input.publicationDate))
      : null;
  const missed = firstQuarter ? closedWindowsFrom(firstQuarter, today) : [];

  if (missed.length > 0) {
    const since = input.lastPayoutDate
      ? `since ${formatLongDate(input.lastPayoutDate)}`
      : 'since publication';
    const windows = missed.length === 1 ? '1 payout window has' : `${missed.length} payout windows have`;
    return {
      ...withNext,
      status: 'attention',
      missedWindows: missed.length,
      missedWindowDates: missed.map((w) => toIsoDate(w.deadline)),
      message: `${pending} is pending and no payout has been recorded ${since}; ${windows} closed in that time.`,
    };
  }

  return {
    ...withNext,
    status: 'scheduled',
    message: `${pending} is due by ${formatLongDate(next.deadline)} (royalties for ${next.periodLabel}).`,
  };
}

export interface PortfolioBook extends PayoutInput {
  copiesSold: number;
}

export function summarizePortfolio(books: PortfolioBook[], today: Date) {
  const next = nextPayoutWindow(today);
  let liveBooks = 0;
  let copiesSold = 0;
  let earned = 0;
  let paid = 0;
  let pending = 0;
  let lastPayout: string | null = null;
  let attention = 0;
  for (const book of books) {
    if (book.stage === 'published_live') liveBooks += 1;
    copiesSold += book.copiesSold;
    earned += book.earnedMinor;
    paid += book.paidMinor;
    pending += book.pendingMinor;
    if (book.lastPayoutDate && (!lastPayout || book.lastPayoutDate > lastPayout))
      lastPayout = book.lastPayoutDate;
    if (computePayout(book, today).status === 'attention') attention += 1;
  }
  return {
    totalBooks: books.length,
    liveBooks,
    inProductionBooks: books.length - liveBooks,
    copiesSold,
    earnedMinor: earned,
    paidMinor: paid,
    pendingMinor: pending,
    lastPayoutDate: lastPayout,
    nextPayoutDate: liveBooks > 0 ? toIsoDate(next.deadline) : null,
    nextPayoutPeriod: liveBooks > 0 ? next.periodLabel : null,
    booksNeedingAttention: attention,
  };
}
