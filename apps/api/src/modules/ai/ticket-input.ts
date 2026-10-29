import type { ThreadMessage, TicketInput } from '@bookleaf/ai';
import { formatTicketNumber } from '@bookleaf/contracts';
import { type Executor, schema } from '@bookleaf/db';
import { eq } from 'drizzle-orm';
import { selectBookRecords, toBookFacts } from '../books/records';
import { findTicket, loadMessages, type TicketRow } from '../tickets/queries';

export interface LoadedTicket {
  input: TicketInput;
  row: TicketRow;
  embedding: number[] | null;
}

/**
 * Builds everything Leaf may know about one ticket. Strictly scoped to the ticket's own author:
 * no other author's records can reach a prompt, so even a successful prompt injection has nothing
 * to exfiltrate.
 */
export async function loadTicketInput(tx: Executor, ref: string): Promise<LoadedTicket | null> {
  const row = await findTicket(tx, ref);
  if (!row) return null;
  const [records, authorRows, messages, embeddingRows] = await Promise.all([
    selectBookRecords(tx, eq(schema.books.authorId, row.authorId)),
    tx
      .select({ city: schema.authors.city, joinedDate: schema.authors.joinedDate })
      .from(schema.authors)
      .where(eq(schema.authors.id, row.authorId)),
    loadMessages(tx, row.id),
    tx
      .select({ embedding: schema.tickets.embedding })
      .from(schema.tickets)
      .where(eq(schema.tickets.id, row.id)),
  ]);
  const author = authorRows[0]!;
  const book = records.find((b) => b.id === row.bookId) ?? null;
  const thread: ThreadMessage[] = messages
    .filter((m) => m.senderType !== 'system')
    .map((m) => ({ sender: m.senderType, senderName: m.senderName, body: m.body, createdAt: m.createdAt }));

  return {
    row,
    embedding: embeddingRows[0]?.embedding ?? null,
    input: {
      id: row.id,
      number: formatTicketNumber(row.number),
      subject: row.subject,
      description: row.description,
      createdAt: row.createdAt,
      status: row.status,
      category: row.category,
      priority: row.priority,
      author: {
        id: row.authorId,
        externalId: row.authorExternalId,
        name: row.authorName,
        city: author.city,
        joinedDate: author.joinedDate,
      },
      book: book ? toBookFacts(book) : null,
      portfolio: records.map(toBookFacts),
      messages: thread,
      contextSummary: row.contextSummary,
    },
  };
}
