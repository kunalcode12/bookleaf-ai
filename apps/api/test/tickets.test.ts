import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN,
  ADMIN_2,
  bearer,
  createTestContext,
  createTicket,
  firstBookId,
  PRIYA,
  ROHIT,
  type TestContext,
} from './harness';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

const admin = async () => bearer(await ctx.token(ADMIN));
const author = async (who = PRIYA) => bearer(await ctx.token(who));

describe('submitting a query', () => {
  it('creates the ticket immediately and queues triage in the same transaction', async () => {
    const bookId = await firstBookId(ctx);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/me/tickets',
      headers: await author(),
      payload: {
        bookId,
        subject: 'Royalty for Whispers of the Ganges',
        description: 'My dashboard shows ₹3,570 pending since October. When will it be paid?',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.headers.location).toBe(`/api/v1/me/tickets/${res.json().id}`);
    expect(res.json()).toMatchObject({
      status: 'open',
      number: expect.stringMatching(/^BL-\d{4,}$/),
      messages: [],
    });
    expect(ctx.queue.sent).toContainEqual({
      name: 'ticket.triage',
      data: { ticketId: res.json().id, reason: 'created' },
    });
  });

  it('accepts "General / Account Level" queries without a book', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/me/tickets',
      headers: await author(),
      payload: {
        subject: 'Changing my registered email',
        description: 'I would like to change the email address on my account.',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().book).toBeNull();
  });

  it('is idempotent with an Idempotency-Key', async () => {
    const headers = { ...(await author()), 'idempotency-key': '0c8e0cfa-55f5-4f3b-9a64-7f4a3b2a1c11' };
    const payload = {
      bookId: null,
      subject: 'Duplicate-safe query',
      description: 'Submitting this twice must create one ticket.',
    };
    const first = await ctx.app.inject({ method: 'POST', url: '/api/v1/me/tickets', headers, payload });
    const second = await ctx.app.inject({ method: 'POST', url: '/api/v1/me/tickets', headers, payload });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json().id).toBe(first.json().id);
  });

  it('explains validation failures field by field', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/me/tickets',
      headers: await author(),
      payload: { subject: 'Hi', description: 'short' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().detail).toBe('Some fields need your attention.');
    expect(
      res
        .json()
        .errors.map((e: { path: string }) => e.path)
        .sort(),
    ).toEqual(['description', 'subject']);
  });
});

describe('admin queue', () => {
  it('filters by status, category and priority and puts the most urgent first', async () => {
    const t1 = await createTicket(ctx, ROHIT, {
      subject: 'Low priority question',
      description: 'Can I update my author photo on the BookLeaf Store page?',
    });
    const t2 = await createTicket(ctx, ROHIT, {
      subject: 'Book unavailable on Amazon',
      description: 'Code & Karma shows currently unavailable on Amazon India since this morning.',
    });
    const h = await admin();
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/tickets/${t1.id}`,
      headers: h,
      payload: { priority: 'low', category: 'general_inquiry' },
    });
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/tickets/${t2.id}`,
      headers: h,
      payload: { priority: 'critical', category: 'distribution_availability' },
    });

    const queue = await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/tickets?limit=50', headers: h });
    expect(queue.statusCode).toBe(200);
    const ids = queue.json().data.map((t: { id: string }) => t.id);
    expect(ids.indexOf(t2.id)).toBeLessThan(ids.indexOf(t1.id));
    expect(queue.json().data[0].priority).toBe('critical');

    const filtered = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/admin/tickets?status=open&category=distribution_availability&priority=critical,high',
      headers: h,
    });
    expect(filtered.json().data.map((t: { id: string }) => t.id)).toEqual([t2.id]);

    const stats = await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/tickets/stats', headers: h });
    expect(stats.json().critical).toBeGreaterThanOrEqual(1);
  });

  it('finds tickets by BL-number and full text', async () => {
    const t = await createTicket(ctx, PRIYA, {
      subject: 'Kindle edition question',
      description: 'Is there a Kindle edition planned for my memoir?',
    });
    const h = await admin();
    const byNumber = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/admin/tickets?q=${t.number}`,
      headers: h,
    });
    expect(byNumber.json().data[0].id).toBe(t.id);
    const byText = await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/tickets?q=kindle', headers: h });
    expect(byText.json().data.map((x: { id: string }) => x.id)).toContain(t.id);
  });

  it('rejects unknown filter values', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/admin/tickets?priority=urgent',
      headers: await admin(),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().detail).toBe('Some query parameters need your attention.');
  });
});

describe('ticket lifecycle', () => {
  it('records admin overrides and protects concurrent edits with ETags', async () => {
    const t = await createTicket(ctx);
    const h = await admin();
    const get = await ctx.app.inject({ method: 'GET', url: `/api/v1/admin/tickets/${t.id}`, headers: h });
    const etag = get.headers.etag as string;
    expect(etag).toMatch(/^W\/"\d+"$/);

    const first = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/tickets/${t.id}`,
      headers: { ...h, 'if-match': etag },
      payload: { category: 'royalty_payments', priority: 'high' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().triage).toMatchObject({
      categorySource: 'admin',
      prioritySource: 'admin',
      priority: 'high',
    });

    const stale = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/tickets/${t.id}`,
      headers: { ...h, 'if-match': etag },
      payload: { priority: 'low' },
    });
    expect(stale.statusCode).toBe(412);
    expect(stale.json().code).toBe('PRECONDITION_FAILED');
  });

  it('follows the state machine and explains illegal transitions', async () => {
    const t = await createTicket(ctx);
    const h = await admin();
    const closed = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/tickets/${t.id}`,
      headers: h,
      payload: { status: 'closed' },
    });
    expect(closed.statusCode).toBe(200);
    const reopen = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/tickets/${t.id}`,
      headers: h,
      payload: { status: 'open' },
    });
    expect(reopen.statusCode).toBe(409);
    expect(reopen.json().code).toBe('TICKET_CLOSED');

    const reply = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/me/tickets/${t.id}/messages`,
      headers: await author(),
      payload: { body: 'Hello? Anyone there?' },
    });
    expect(reply.statusCode).toBe(409);
  });

  it('delivers the admin reply to the author and moves the ticket along', async () => {
    const t = await createTicket(ctx);
    const h = await admin();
    const sent = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/admin/tickets/${t.id}/messages`,
      headers: h,
      payload: {
        body: 'Hi Priya, I have checked your payout records and escalated this to finance.',
        resolve: false,
      },
    });
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({ status: 'in_progress', assignee: { displayName: 'Aarav Mehta' } });

    const view = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/me/tickets/${t.id}`,
      headers: await author(),
    });
    expect(view.json().status).toBe('in_progress');
    expect(view.json().messages.at(-1)).toMatchObject({
      sender: 'admin',
      senderName: 'Aarav Mehta',
      senderTitle: 'Support Lead',
      body: expect.stringContaining('escalated this to finance'),
    });

    const notifications = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: await author(),
    });
    expect(notifications.json().data.some((n: { ticketId: string }) => n.ticketId === t.id)).toBe(true);
    expect(ctx.queue.sent.some((j) => j.name === 'notify.email')).toBe(true);
  });

  it('reopens a resolved ticket when the author writes back, and takes feedback once resolved', async () => {
    const t = await createTicket(ctx);
    const h = await admin();
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/admin/tickets/${t.id}/messages`,
      headers: h,
      payload: {
        body: 'Your payout was processed today. You should see it within 2 business days.',
        resolve: true,
      },
    });
    const early = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/me/tickets/${t.id}`,
      headers: await author(),
    });
    expect(early.json()).toMatchObject({ status: 'resolved', canGiveFeedback: true });

    const feedback = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/me/tickets/${t.id}/feedback`,
      headers: await author(),
      payload: { rating: 'up', comment: 'Thanks!' },
    });
    expect(feedback.json()).toMatchObject({ feedback: { rating: 'up' }, canGiveFeedback: false });

    const followUp = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/me/tickets/${t.id}/messages`,
      headers: await author(),
      payload: { body: 'It has not arrived yet, could you check again?' },
    });
    expect(followUp.statusCode).toBe(201);
    expect(followUp.json().status).toBe('open');
    expect(followUp.json().timeline.map((e: { type: string }) => e.type)).toContain('reopened');
  });

  it('prevents two admins from silently taking the same ticket', async () => {
    const t = await createTicket(ctx);
    const aarav = await admin();
    const isha = bearer(await ctx.token(ADMIN_2));
    const mine = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/tickets/${t.id}/assignee`,
      headers: aarav,
      payload: { assigneeId: 'me' },
    });
    expect(mine.json().assignee.displayName).toBe('Aarav Mehta');

    const clash = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/tickets/${t.id}/assignee`,
      headers: isha,
      payload: { assigneeId: 'me' },
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json()).toMatchObject({
      code: 'ASSIGNMENT_CONFLICT',
      meta: { assignee: { displayName: 'Aarav Mehta' } },
    });

    const forced = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/tickets/${t.id}/assignee`,
      headers: isha,
      payload: { assigneeId: 'me', force: true },
    });
    expect(forced.json().assignee.displayName).toBe('Isha Verma');
  });
});

describe('demo dataset', () => {
  it('seeds a realistic queue whose history replays through the real lifecycle', async () => {
    const demo = await createTestContext({ demoTickets: true });
    try {
      const h = bearer(await demo.token(ADMIN));
      const res = await demo.app.inject({ method: 'GET', url: '/api/v1/admin/tickets?limit=50', headers: h });
      expect(res.json().data).toHaveLength(13);
      const closed = res.json().data.find((t: { status: string }) => t.status === 'closed');
      const detail = await demo.app.inject({
        method: 'GET',
        url: `/api/v1/admin/tickets/${closed.id}`,
        headers: h,
      });
      expect(detail.json().messages.length).toBeGreaterThan(1);
      expect(detail.json().feedback).toMatchObject({ rating: 'up' });
    } finally {
      await demo.close();
    }
  });
});
