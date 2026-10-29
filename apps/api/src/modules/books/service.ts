import type { Book, BookListResponse } from '@bookleaf/contracts';
import { type Database, schema, withActor } from '@bookleaf/db';
import { and, eq } from 'drizzle-orm';
import type { RequestActor } from '../../http/context';
import { authorIdOf } from '../../http/context';
import type { Clock } from '../../lib/clock';
import { Errors } from '../../lib/errors';
import { selectBookRecords, toBookDto, toPortfolioDto } from './records';

export class BookService {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  /** The author's bookshelf — every book, including those still in production. */
  async listForAuthor(actor: RequestActor): Promise<BookListResponse> {
    const authorId = authorIdOf(actor);
    const records = await withActor(
      this.db,
      actor.db,
      (tx) => selectBookRecords(tx, eq(schema.books.authorId, authorId)),
      { readOnly: true },
    );
    const today = this.clock.now();
    return { data: records.map((r) => toBookDto(r, today)), summary: toPortfolioDto(records, today) };
  }

  async getForAuthor(actor: RequestActor, bookId: string): Promise<Book> {
    const authorId = authorIdOf(actor);
    const [record] = await withActor(
      this.db,
      actor.db,
      (tx) => selectBookRecords(tx, and(eq(schema.books.id, bookId), eq(schema.books.authorId, authorId))!),
      { readOnly: true },
    );
    if (!record) throw Errors.notFound('Book');
    return toBookDto(record, this.clock.now());
  }
}
