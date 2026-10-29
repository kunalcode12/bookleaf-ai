import type { BookFacts } from '@bookleaf/ai';
import {
  type Book,
  type PortfolioSummary,
  PRINT_PARTNER_LABELS,
  PRODUCTION_STAGE_LABELS,
  type PrintPartner,
  type ProductionStage,
  SALES_PLATFORM_LABELS,
  type SalesPlatform,
} from '@bookleaf/contracts';
import { type Executor, schema } from '@bookleaf/db';
import { computePayout, describeStage, summarizePortfolio } from '@bookleaf/domain';
import { asc, desc, getTableColumns, type SQL, sql } from 'drizzle-orm';

const { books, bookListings, tickets } = schema;

export interface BookRecord {
  id: string;
  externalId: string;
  authorId: string;
  title: string;
  isbn: string;
  genre: string;
  publicationDate: string | null;
  stage: ProductionStage;
  mrpMinor: number | null;
  royaltyPerCopyMinor: number | null;
  copiesSold: number;
  earnedMinor: number;
  paidMinor: number;
  pendingMinor: number;
  lastPayoutDate: string | null;
  printPartner: PrintPartner | null;
  platforms: SalesPlatform[];
  openTicketCount: number;
}

/** Books with their listings and open-ticket counts in one round trip. */
export async function selectBookRecords(tx: Executor, where: SQL): Promise<BookRecord[]> {
  const rows = await tx
    .select({
      ...getTableColumns(books),
      platforms: sql<
        string[]
      >`coalesce(array_agg(${bookListings.platform}::text order by ${bookListings.platform}) filter (where ${bookListings.platform} is not null), '{}'::text[])`,
      openTicketCount: sql<number>`(select count(*)::int from ${tickets} where ${tickets.bookId} = ${books.id} and ${tickets.status} in ('open', 'in_progress'))`,
    })
    .from(books)
    .leftJoin(bookListings, sql`${bookListings.bookId} = ${books.id}`)
    .where(where)
    .groupBy(books.id)
    .orderBy(desc(sql`${books.stage} = 'published_live'`), desc(books.publicationDate), asc(books.title));

  return rows.map((r) => ({
    id: r.id,
    externalId: r.externalId,
    authorId: r.authorId,
    title: r.title,
    isbn: r.isbn,
    genre: r.genre,
    publicationDate: r.publicationDate,
    stage: r.stage,
    mrpMinor: r.mrpMinor,
    royaltyPerCopyMinor: r.royaltyPerCopyMinor,
    copiesSold: r.copiesSold,
    earnedMinor: r.royaltyEarnedMinor,
    paidMinor: r.royaltyPaidMinor,
    pendingMinor: r.royaltyPendingMinor,
    lastPayoutDate: r.lastPayoutDate,
    printPartner: r.printPartner,
    platforms: (r.platforms ?? []) as SalesPlatform[],
    openTicketCount: Number(r.openTicketCount ?? 0),
  }));
}

const money = (amountMinor: number) => ({ amountMinor, currency: 'INR' as const });

export function toBookDto(record: BookRecord, today: Date): Book {
  const payout = computePayout(
    {
      stage: record.stage,
      publicationDate: record.publicationDate,
      earnedMinor: record.earnedMinor,
      paidMinor: record.paidMinor,
      pendingMinor: record.pendingMinor,
      lastPayoutDate: record.lastPayoutDate,
    },
    today,
  );
  return {
    id: record.id,
    externalId: record.externalId,
    title: record.title,
    isbn: record.isbn,
    genre: record.genre,
    publicationDate: record.publicationDate,
    status: record.stage,
    statusLabel: PRODUCTION_STAGE_LABELS[record.stage],
    mrp: record.mrpMinor === null ? null : money(record.mrpMinor),
    royaltyPerCopy: record.royaltyPerCopyMinor === null ? null : money(record.royaltyPerCopyMinor),
    copiesSold: record.copiesSold,
    royaltyEarned: money(record.earnedMinor),
    royaltyPaid: money(record.paidMinor),
    royaltyPending: money(record.pendingMinor),
    printPartner: record.printPartner,
    printPartnerLabel: record.printPartner ? PRINT_PARTNER_LABELS[record.printPartner] : null,
    availableOn: record.platforms.map((platform) => ({ platform, label: SALES_PLATFORM_LABELS[platform] })),
    payout: {
      status: payout.status,
      lastPayoutDate: payout.lastPayoutDate,
      nextPayoutDate: payout.nextPayoutDate,
      nextPayoutPeriod: payout.nextPayoutPeriod,
      missedWindows: payout.missedWindows,
      belowThreshold: payout.belowThreshold,
      thresholdMinor: payout.thresholdMinor,
      message: payout.message,
    },
    production: describeStage(record.stage),
    openTicketCount: record.openTicketCount,
  };
}

export function toPortfolioDto(records: BookRecord[], today: Date): PortfolioSummary {
  const summary = summarizePortfolio(
    records.map((r) => ({
      stage: r.stage,
      publicationDate: r.publicationDate,
      earnedMinor: r.earnedMinor,
      paidMinor: r.paidMinor,
      pendingMinor: r.pendingMinor,
      lastPayoutDate: r.lastPayoutDate,
      copiesSold: r.copiesSold,
    })),
    today,
  );
  return {
    totalBooks: summary.totalBooks,
    liveBooks: summary.liveBooks,
    inProductionBooks: summary.inProductionBooks,
    copiesSold: summary.copiesSold,
    royaltyEarned: money(summary.earnedMinor),
    royaltyPaid: money(summary.paidMinor),
    royaltyPending: money(summary.pendingMinor),
    lastPayoutDate: summary.lastPayoutDate,
    nextPayoutDate: summary.nextPayoutDate,
    nextPayoutPeriod: summary.nextPayoutPeriod,
    booksNeedingAttention: summary.booksNeedingAttention,
  };
}

/** The shape Leaf receives (no ticket counts, no ids beyond what it cites). */
export function toBookFacts(record: BookRecord): BookFacts {
  return {
    id: record.id,
    externalId: record.externalId,
    title: record.title,
    isbn: record.isbn,
    genre: record.genre,
    stage: record.stage,
    publicationDate: record.publicationDate,
    mrpMinor: record.mrpMinor,
    royaltyPerCopyMinor: record.royaltyPerCopyMinor,
    copiesSold: record.copiesSold,
    earnedMinor: record.earnedMinor,
    paidMinor: record.paidMinor,
    pendingMinor: record.pendingMinor,
    lastPayoutDate: record.lastPayoutDate,
    printPartner: record.printPartner,
    platforms: record.platforms,
  };
}
