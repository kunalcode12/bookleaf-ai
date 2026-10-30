import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, bearer, createTestContext, createTicket, PRIYA, ROHIT, type TestContext } from './harness';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

describe('role-based access', () => {
  it('keeps authors out of the admin desk', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/admin/tickets',
      headers: bearer(await ctx.token(PRIYA)),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
  });

  it('keeps admins out of author-only routes', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/me/books',
      headers: bearer(await ctx.token(ADMIN)),
    });
    expect(res.statusCode).toBe(403);
  });

  it('checks the role before validating input (no schema probing)', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/tickets/BL-1001',
      headers: bearer(await ctx.token(PRIYA)),
      payload: { status: 'not-a-status' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('author data isolation', () => {
  it('shows each author only their own books', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/me/books',
      headers: bearer(await ctx.token(PRIYA)),
    });
    expect(res.statusCode).toBe(200);
    const titles = res.json().data.map((b: { title: string }) => b.title);
    expect(titles.sort()).toEqual(['The Saffron Diaries', 'Whispers of the Ganges']);
    expect(res.json().summary.royaltyPending.amountMinor).toBe(357_000);
  });

  it("returns 404 (not 403) for another author's book or ticket", async () => {
    const rohitBooks = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/me/books',
      headers: bearer(await ctx.token(ROHIT)),
    });
    const rohitBook = rohitBooks.json().data[0].id;
    const book = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/me/books/${rohitBook}`,
      headers: bearer(await ctx.token(PRIYA)),
    });
    expect(book.statusCode).toBe(404);

    const rohitTicket = await createTicket(ctx, ROHIT);
    for (const ref of [rohitTicket.id, rohitTicket.number]) {
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/me/tickets/${ref}`,
        headers: bearer(await ctx.token(PRIYA)),
      });
      expect(res.statusCode).toBe(404);
    }
    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/me/tickets',
      headers: bearer(await ctx.token(PRIYA)),
    });
    expect(list.json().data.map((t: { id: string }) => t.id)).not.toContain(rohitTicket.id);
  });

  it("refuses to file a ticket against another author's book", async () => {
    const rohitBooks = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/me/books',
      headers: bearer(await ctx.token(ROHIT)),
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/me/tickets',
      headers: bearer(await ctx.token(PRIYA)),
      payload: {
        bookId: rohitBooks.json().data[0].id,
        subject: 'Question about this book',
        description: 'Trying to attach a ticket to a book that is not mine.',
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors[0].path).toBe('bookId');
  });

  it('never exposes internal notes or internal events to the author', async () => {
    const ticket = await createTicket(ctx, PRIYA);
    const admin = bearer(await ctx.token(ADMIN));
    const note = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/admin/tickets/${ticket.id}/notes`,
      headers: admin,
      payload: { body: 'INTERNAL: finance confirmed the Q3 payout batch failed for this author.' },
    });
    expect(note.statusCode).toBe(201);

    const view = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/me/tickets/${ticket.id}`,
      headers: bearer(await ctx.token(PRIYA)),
    });
    expect(view.statusCode).toBe(200);
    expect(view.body).not.toContain('INTERNAL: finance');
    expect(view.json()).not.toHaveProperty('notes');

    const adminView = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/admin/tickets/${ticket.id}`,
      headers: admin,
    });
    expect(adminView.json().notes[0].body).toContain('INTERNAL: finance');
  });

  it('enforces isolation in the database itself (row-level security), not only in code', async () => {
    const { withActor, schema } = await import('@bookleaf/db');
    const profile = await ctx.container.profiles.byUserId(
      (
        await ctx.app.inject({
          method: 'GET',
          url: '/api/v1/auth/session',
          headers: bearer(await ctx.token(PRIYA)),
        })
      ).json().user.id,
    );
    const actor = { kind: 'author' as const, profileId: profile!.id, authorId: profile!.author!.id };
    const visible = await withActor(ctx.container.handle.db, actor, (tx) =>
      tx.select({ id: schema.books.authorId }).from(schema.books),
    );
    expect(new Set(visible.map((b) => b.id))).toEqual(new Set([actor.authorId]));
    const notes = await withActor(ctx.container.handle.db, actor, (tx) =>
      tx.select().from(schema.ticketNotes),
    );
    expect(notes).toHaveLength(0);
  });
});

describe('origin secret', () => {
  it('rejects direct calls, but keeps health checks and the API reference reachable', async () => {
    const secret = 'shared-secret-only-the-web-proxy-knows';
    const gated = await createTestContext({ env: { ORIGIN_SECRET: secret } });
    try {
      const login = { method: 'POST' as const, url: '/api/v1/auth/token', payload: PRIYA };
      expect((await gated.app.inject(login)).statusCode).toBe(403);
      expect((await gated.app.inject({ ...login, headers: { 'x-origin-secret': 'guess' } })).statusCode).toBe(
        403,
      );
      expect((await gated.app.inject({ ...login, headers: { 'x-origin-secret': secret } })).statusCode).toBe(
        200,
      );
      for (const url of ['/health/live', '/docs', '/openapi.json']) {
        expect((await gated.app.inject({ method: 'GET', url })).statusCode, url).toBeLessThan(400);
      }
    } finally {
      await gated.close();
    }
  });
});
