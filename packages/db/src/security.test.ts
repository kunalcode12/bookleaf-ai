import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, withActor } from './actor';
import { createDatabase, type DatabaseHandle } from './client';
import { runMigrations } from './migrate';
import * as s from './schema';

let handle: DatabaseHandle;

const ids = {
  authorA: '',
  authorB: '',
  profileA: randomUUID(),
  profileB: randomUUID(),
  admin: randomUUID(),
  bookA: '',
  ticketA: '',
  ticketB: '',
};

let authorA: Actor;
let authorB: Actor;
let admin: Actor;

beforeAll(async () => {
  handle = await createDatabase({ url: 'pglite://memory' });
  await runMigrations(handle);
  const db = handle.db; // table owner: setup bypasses RLS

  const [a, b] = await db
    .insert(s.authors)
    .values([
      { externalId: 'AUTH-A', name: 'Author A', email: 'a@bookleaf.test', joinedDate: '2024-01-01' },
      { externalId: 'AUTH-B', name: 'Author B', email: 'b@bookleaf.test', joinedDate: '2024-01-01' },
    ])
    .returning({ id: s.authors.id });
  ids.authorA = a!.id;
  ids.authorB = b!.id;

  await db.insert(s.profiles).values([
    {
      id: ids.profileA,
      email: 'a@bookleaf.test',
      role: 'author',
      displayName: 'Author A',
      authorId: ids.authorA,
    },
    {
      id: ids.profileB,
      email: 'b@bookleaf.test',
      role: 'author',
      displayName: 'Author B',
      authorId: ids.authorB,
    },
    { id: ids.admin, email: 'ops@bookleaf.test', role: 'admin', displayName: 'Ops' },
  ]);

  const [book] = await db
    .insert(s.books)
    .values({
      externalId: 'BK-A',
      authorId: ids.authorA,
      title: 'Book A',
      isbn: 'ISBN-A',
      genre: 'Fiction',
      publicationDate: '2024-02-01',
      stage: 'published_live',
      mrpMinor: 39_900,
      royaltyPerCopyMinor: 3_500,
      copiesSold: 10,
      royaltyEarnedMinor: 35_000,
      royaltyPaidMinor: 10_000,
    })
    .returning({ id: s.books.id, pending: s.books.royaltyPendingMinor });
  ids.bookA = book!.id;
  expect(book!.pending).toBe(25_000);

  const [ta, tb] = await db
    .insert(s.tickets)
    .values([
      {
        authorId: ids.authorA,
        createdById: ids.profileA,
        bookId: ids.bookA,
        subject: 'A question',
        description: 'About my royalty',
      },
      {
        authorId: ids.authorB,
        createdById: ids.profileB,
        subject: 'B question',
        description: 'Something else',
      },
    ])
    .returning({ id: s.tickets.id, number: s.tickets.number });
  ids.ticketA = ta!.id;
  ids.ticketB = tb!.id;
  expect(ta!.number).toBe(1001);

  await db
    .insert(s.ticketNotes)
    .values({ ticketId: ids.ticketA, authorId: ids.admin, body: 'Internal: check ledger' });

  authorA = { kind: 'author', profileId: ids.profileA, authorId: ids.authorA };
  authorB = { kind: 'author', profileId: ids.profileB, authorId: ids.authorB };
  admin = { kind: 'admin', profileId: ids.admin };
});

afterAll(async () => {
  await handle?.close();
});

describe('row-level security', () => {
  it('lets an author see only their own tickets and books', async () => {
    const [tickets, books] = await withActor(handle.db, authorA, async (tx) => [
      await tx.select({ id: s.tickets.id }).from(s.tickets),
      await tx.select({ id: s.books.id }).from(s.books),
    ]);
    expect(tickets.map((t) => t.id)).toEqual([ids.ticketA]);
    expect(books.map((b) => b.id)).toEqual([ids.bookA]);

    const other = await withActor(handle.db, authorB, (tx) => tx.select({ id: s.books.id }).from(s.books));
    expect(other).toEqual([]);
  });

  it('never exposes internal notes to authors, even on their own ticket', async () => {
    const notes = await withActor(handle.db, authorA, (tx) => tx.select().from(s.ticketNotes));
    expect(notes).toEqual([]);
    const staffNotes = await withActor(handle.db, admin, (tx) => tx.select().from(s.ticketNotes));
    expect(staffNotes).toHaveLength(1);
  });

  it("rejects an author creating a ticket on someone else's account", async () => {
    await expect(
      withActor(handle.db, authorA, (tx) =>
        tx.insert(s.tickets).values({
          authorId: ids.authorB,
          createdById: ids.profileA,
          subject: 'Spoofed',
          description: 'Trying to post as B',
        }),
      ),
    ).rejects.toThrow();
  });

  it('gives admins and the system worker full visibility', async () => {
    const forAdmin = await withActor(handle.db, admin, (tx) =>
      tx.select({ id: s.tickets.id }).from(s.tickets),
    );
    const forSystem = await withActor(handle.db, { kind: 'system' }, (tx) =>
      tx.select({ id: s.tickets.id }).from(s.tickets),
    );
    expect(forAdmin).toHaveLength(2);
    expect(forSystem).toHaveLength(2);
  });

  it('fails closed when a transaction forgets to set the actor', async () => {
    const rows = await handle.db.transaction(async (tx) => {
      await tx.execute(sql.raw('set local role bookleaf_app'));
      return tx.select({ id: s.tickets.id }).from(s.tickets);
    });
    expect(rows).toEqual([]);
  });
});

describe('integrity constraints', () => {
  it('rejects a royalty ledger where earned ≠ copies × per-copy royalty', async () => {
    await expect(
      handle.db.insert(s.books).values({
        externalId: 'BK-BAD',
        authorId: ids.authorA,
        title: 'Bad ledger',
        isbn: 'ISBN-BAD',
        genre: 'Fiction',
        publicationDate: '2024-02-01',
        stage: 'published_live',
        mrpMinor: 10_000,
        royaltyPerCopyMinor: 1_000,
        copiesSold: 5,
        royaltyEarnedMinor: 9_999,
      }),
    ).rejects.toThrow();
  });

  it('rejects sales on a book that is still in production', async () => {
    await expect(
      handle.db.insert(s.books).values({
        externalId: 'BK-PROD',
        authorId: ids.authorA,
        title: 'Not out yet',
        isbn: 'ISBN-PROD',
        genre: 'Fiction',
        stage: 'typesetting',
        copiesSold: 3,
      }),
    ).rejects.toThrow();
  });
});

describe('realtime notifications', () => {
  it('emits a NOTIFY with ids only when a ticket event commits', async () => {
    const received: string[] = [];
    const unlisten = await handle.listen('bookleaf_events', (payload) => received.push(payload));
    await withActor(handle.db, admin, (tx) =>
      tx.insert(s.ticketEvents).values({
        ticketId: ids.ticketA,
        actorType: 'admin',
        actorId: ids.admin,
        type: 'ticket.status_changed',
        visibility: 'public',
        payload: { from: 'open', to: 'in_progress' },
      }),
    );
    await new Promise((r) => setTimeout(r, 100));
    await unlisten();
    expect(received).toHaveLength(1);
    const event = JSON.parse(received[0]!);
    expect(event).toMatchObject({
      type: 'ticket.status_changed',
      ticketId: ids.ticketA,
      ticketNumber: 'BL-1001',
      authorId: ids.authorA,
      visibility: 'public',
    });
    expect(Object.keys(event)).not.toContain('payload');
  });

  it('stays silent when the transaction rolls back', async () => {
    const received: string[] = [];
    const unlisten = await handle.listen('bookleaf_events', (payload) => received.push(payload));
    await withActor(handle.db, admin, async (tx) => {
      await tx.insert(s.ticketEvents).values({
        ticketId: ids.ticketA,
        actorType: 'admin',
        type: 'ticket.note_added',
        visibility: 'internal',
      });
      throw new Error('rollback');
    }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 100));
    await unlisten();
    expect(received).toEqual([]);
  });
});
