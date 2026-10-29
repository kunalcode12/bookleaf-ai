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

  private columns() {
    return {
      id: authors.id,
      externalId: authors.externalId,
      name: authors.name,
      email: authors.email,
      phone: authors.phone,
      city: authors.city,
      joinedDate: authors.joinedDate,
      bookCount: sql<number>`(select count(*)::int from ${books} where ${books.authorId} = ${authors.id})`,
      liveBooks: sql<number>`(select count(*)::int from ${books} where ${books.authorId} = ${authors.id} and ${books.stage} = 'published_live')`,
      copiesSold: sql<number>`(select coalesce(sum(${books.copiesSold}), 0)::int from ${books} where ${books.authorId} = ${authors.id})`,
      earned: sql<number>`(select coalesce(sum(${books.royaltyEarnedMinor}), 0)::bigint from ${books} where ${books.authorId} = ${authors.id})`,
      pending: sql<number>`(select coalesce(sum(${books.royaltyPendingMinor}), 0)::bigint from ${books} where ${books.authorId} = ${authors.id})`,
      openTickets: sql<number>`(select count(*)::int from ${tickets} where ${tickets.authorId} = ${authors.id} and ${tickets.status} in ('open', 'in_progress'))`,
    };
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

  private rows(actor: RequestActor, authorId?: string) {
    return withActor(
      this.db,
      actor.db,
      (tx) =>
        tx
          .select(this.columns())
          .from(authors)
          .where(authorId ? eq(authors.id, authorId) : undefined)
          .orderBy(asc(authors.name)),
      { readOnly: true },
    );
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
