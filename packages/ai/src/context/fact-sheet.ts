import { type PayoutStatus, PRINT_PARTNER_LABELS, SALES_PLATFORM_LABELS } from '@bookleaf/contracts';
import { computePayout, describeStage, diffInDays, formatInr, formatLongDate } from '@bookleaf/domain';
import type { BookFacts, TicketInput } from '../types';

export interface Fact {
  id: string;
  label: string;
  text: string;
}

export interface FactSheet {
  facts: Fact[];
  /** "F1 · Author: …" lines, as placed in the prompt. */
  rendered: string;
  /** Payout status of the ticket's book (feeds the triage policy). */
  payoutStatus: PayoutStatus | null;
}

const MAX_PORTFOLIO_BOOKS = 6;

/**
 * Turns BookLeaf's records into numbered, plain-language facts. Everything a reply might need —
 * amounts, dates, statuses, the next payout window — is computed here in code, so the model
 * only has to *use* facts, never derive them. Fact ids let drafts cite exactly what they used.
 */
export function buildFactSheet(
  ticket: TicketInput,
  today: Date,
  options: { includeTicket?: boolean } = {},
): FactSheet {
  const facts: Fact[] = [];
  const add = (label: string, text: string) => facts.push({ id: `F${facts.length + 1}`, label, text });

  const firstName = ticket.author.name.split(/\s+/)[0] ?? ticket.author.name;
  add(
    'Author',
    `${ticket.author.name} (first name: ${firstName}), a BookLeaf author since ${formatLongDate(ticket.author.joinedDate)}${ticket.author.city ? `, based in ${ticket.author.city}` : ''}`,
  );
  if (options.includeTicket ?? true) {
    const age = Math.max(0, diffInDays(today, ticket.createdAt));
    add(
      'Ticket',
      `${ticket.number}, opened on ${formatLongDate(ticket.createdAt)} (${age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`}). Today is ${formatLongDate(today)}`,
    );
  } else {
    add('Today', formatLongDate(today));
  }

  let payoutStatus: PayoutStatus | null = null;
  if (ticket.book) {
    payoutStatus = addBookFacts(ticket.book, today, add);
  } else {
    add('Query scope', 'General / account-level query, not about one specific book');
    const books = ticket.portfolio.slice(0, MAX_PORTFOLIO_BOOKS);
    for (const book of books) add(`Book ${book.externalId}`, summarizeBook(book, today));
    if (ticket.portfolio.length > MAX_PORTFOLIO_BOOKS) {
      add('More books', `${ticket.portfolio.length - MAX_PORTFOLIO_BOOKS} further books not listed`);
    }
    const pending = ticket.portfolio.reduce((sum, b) => sum + b.pendingMinor, 0);
    const earned = ticket.portfolio.reduce((sum, b) => sum + b.earnedMinor, 0);
    add(
      'Account totals',
      `${ticket.portfolio.length} book${ticket.portfolio.length === 1 ? '' : 's'}; ${formatInr(earned)} earned in total; ${formatInr(pending)} pending`,
    );
  }

  return {
    facts,
    rendered: facts.map((f) => `${f.id} · ${f.label}: ${f.text}`).join('\n'),
    payoutStatus,
  };
}

function addBookFacts(
  book: BookFacts,
  today: Date,
  add: (label: string, text: string) => void,
): PayoutStatus {
  add('Book', `"${book.title}" (${book.externalId}), ISBN ${book.isbn}, genre ${book.genre}`);
  const published = book.stage === 'published_live';
  if (published && book.publicationDate) {
    add('Status', `Published & Live since ${formatLongDate(book.publicationDate)}`);
  } else {
    const stage = describeStage(book.stage);
    add(
      'Status',
      `In production, currently at ${stage.stageLabel} (step ${stage.stepNumber} of ${stage.totalSteps}). ${stage.stageDescription}${stage.commonDelay ? ` ${stage.commonDelay}` : ''}`,
    );
  }
  add(
    'Availability',
    book.platforms.length > 0
      ? `Listed on ${book.platforms.map((p) => SALES_PLATFORM_LABELS[p]).join(', ')}`
      : 'Not yet listed on any sales platform',
  );
  if (book.printPartner) add('Printing', `Printed by ${PRINT_PARTNER_LABELS[book.printPartner]}`);

  const payout = computePayout(
    {
      stage: book.stage,
      publicationDate: book.publicationDate,
      earnedMinor: book.earnedMinor,
      paidMinor: book.paidMinor,
      pendingMinor: book.pendingMinor,
      lastPayoutDate: book.lastPayoutDate,
    },
    today,
  );

  if (!published) {
    add('Royalties', 'No sales or royalties yet, because the book is not published');
    return payout.status;
  }
  if (book.mrpMinor !== null && book.royaltyPerCopyMinor !== null) {
    add(
      'Price and royalty rate',
      `MRP ${formatInr(book.mrpMinor)}; author royalty ${formatInr(book.royaltyPerCopyMinor)} per copy sold`,
    );
  }
  add(
    'Sales and royalties',
    `${book.copiesSold} copies sold; ${formatInr(book.earnedMinor)} earned in total; ${formatInr(book.paidMinor)} paid out; ${formatInr(book.pendingMinor)} pending`,
  );
  add('Last payout', book.lastPayoutDate ? formatLongDate(book.lastPayoutDate) : 'No payout recorded yet');
  add('Payout status', payout.message);
  if (payout.nextPayoutDate && payout.nextPayoutPeriod) {
    add(
      'Next payout window',
      `Royalties for ${payout.nextPayoutPeriod} are due by ${formatLongDate(payout.nextPayoutDate)}`,
    );
  }
  if (payout.missedWindowDates.length > 0) {
    add(
      'Payout windows closed without a payout',
      payout.missedWindowDates.map((d) => formatLongDate(d)).join(', '),
    );
  }
  return payout.status;
}

function summarizeBook(book: BookFacts, today: Date): string {
  if (book.stage !== 'published_live') {
    const stage = describeStage(book.stage);
    return `"${book.title}", in production at ${stage.stageLabel} (step ${stage.stepNumber} of ${stage.totalSteps})`;
  }
  const payout = computePayout(
    {
      stage: book.stage,
      publicationDate: book.publicationDate,
      earnedMinor: book.earnedMinor,
      paidMinor: book.paidMinor,
      pendingMinor: book.pendingMinor,
      lastPayoutDate: book.lastPayoutDate,
    },
    today,
  );
  return `"${book.title}", Published & Live; ${book.copiesSold} copies sold; ${formatInr(book.pendingMinor)} pending; last payout ${book.lastPayoutDate ? formatLongDate(book.lastPayoutDate) : 'none yet'}; ${payout.message}`;
}

/** One-line account context for triage (short: classification doesn't need the full sheet). */
export function triageContext(ticket: TicketInput, today: Date): string {
  if (!ticket.book) {
    const live = ticket.portfolio.filter((b) => b.stage === 'published_live').length;
    return `General / account-level query. Author has ${ticket.portfolio.length} book(s), ${live} published.`;
  }
  return `Book: ${summarizeBook(ticket.book, today)}`;
}
