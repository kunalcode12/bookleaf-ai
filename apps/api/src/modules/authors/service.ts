import type { AuthorDetail, AuthorListItem } from '@bookleaf/contracts';
import { type Database, schema, withActor } from '@bookleaf/db';
import { asc, eq, sql } from 'drizzle-orm';
import type { RequestActor } from '../../http/context';
import type { Clock } from '../../lib/clock';
import { Errors } from '../../lib/errors';
import { selectBookRecords, toBookDto } from '../books/records';
import { toAdminListItem } from '../tickets/mapper';
import { listAdminTickets } from '../tickets/queries';

const { authors, books, tickets } = schema;
const money = (amountMinor: number) => ({ amountMinor, currency: 'INR' as const });

/** Admin view of BookLeaf's authors: portfolio totals and open support load at a glance. */
export class AuthorService {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  private rows(actor: RequestActor, authorId?: string) {
    return withActor(
      this.db,
      actor.db,
      (tx) => {
        // Pre-aggregated per author and joined, rather than correlated subqueries: Drizzle drops
        // table qualifiers inside sql`` fields of a single-table select, which would silently
        // correlate the subquery with itself.
        const bookStats = tx
          .select({
            authorId: books.authorId,
            bookCount: sql<number>`count(*)::int`.as('book_count'),
            liveBooks: sql<number>`(count(*) filter (where ${books.stage} = 'published_live'))::int`.as(
              'live_books',
            ),
            copiesSold: sql<number>`coalesce(sum(${books.copiesSold}), 0)::int`.as('copies_sold'),
            earned: sql<number>`coalesce(sum(${books.royaltyEarnedMinor}), 0)::bigint`.as('earned'),
            pending: sql<number>`coalesce(sum(${books.royaltyPendingMinor}), 0)::bigint`.as('pending'),
          })
          .from(books)
          .groupBy(books.authorId)
          .as('book_stats');
        const ticketStats = tx
          .select({
            authorId: tickets.authorId,
            openTickets:
              sql<number>`(count(*) filter (where ${tickets.status} in ('open', 'in_progress')))::int`.as(
                'open_tickets',
              ),
          })
          .from(tickets)
          .groupBy(tickets.authorId)
          .as('ticket_stats');

        return tx
          .select({
            id: authors.id,
            externalId: authors.externalId,
            name: authors.name,
            email: authors.email,
            phone: authors.phone,
            city: authors.city,
            joinedDate: authors.joinedDate,
            bookCount: sql<number>`coalesce(${bookStats.bookCount}, 0)`,
            liveBooks: sql<number>`coalesce(${bookStats.liveBooks}, 0)`,
            copiesSold: sql<number>`coalesce(${bookStats.copiesSold}, 0)`,
            earned: sql<number>`coalesce(${bookStats.earned}, 0)`,
            pending: sql<number>`coalesce(${bookStats.pending}, 0)`,
            openTickets: sql<number>`coalesce(${ticketStats.openTickets}, 0)`,
          })
          .from(authors)
          .leftJoin(bookStats, eq(bookStats.authorId, authors.id))
          .leftJoin(ticketStats, eq(ticketStats.authorId, authors.id))
          .where(authorId ? eq(authors.id, authorId) : undefined)
          .orderBy(asc(authors.name));
      },
      { readOnly: true },
    );
  }

  private toItem(row: Awaited<ReturnType<AuthorService['rows']>>[number]): AuthorListItem {
    return {
      id: row.id,
      externalId: row.externalId,
      name: row.name,
      email: row.email,
      city: row.city,
      joinedDate: row.joinedDate,
      bookCount: Number(row.bookCount),
      liveBooks: Number(row.liveBooks),
      copiesSold: Number(row.copiesSold),
      royaltyEarned: money(Number(row.earned)),
      royaltyPending: money(Number(row.pending)),
      openTickets: Number(row.openTickets),
    };
  }

  async list(actor: RequestActor): Promise<AuthorListItem[]> {
    return (await this.rows(actor)).map((r) => this.toItem(r));
  }

  async get(actor: RequestActor, authorId: string): Promise<AuthorDetail> {
    const now = this.clock.now();
    const [row] = await this.rows(actor, authorId);
    if (!row) throw Errors.notFound('Author');
    const { records, ticketRows } = await withActor(
      this.db,
      actor.db,
      async (tx) => ({
        records: await selectBookRecords(tx, eq(books.authorId, authorId)),
        ticketRows: (
          await listAdminTickets(
            tx,
            { authorId, sort: 'newest', limit: 50 },
            { profileId: actor.profileId, now, offset: 0 },
          )
        ).rows,
      }),
      { readOnly: true },
    );
    return {
      ...this.toItem(row),
      phone: row.phone,
      books: records.map((r) => toBookDto(r, now)),
      tickets: ticketRows.map((t) => toAdminListItem(t, now)),
    };
  }
}
