import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, bearer, createTestContext, createTicket, PRIYA, type TestContext } from './harness';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

const admin = async () => bearer(await ctx.token(ADMIN));

describe('author directory', () => {
  it("totals each author's own catalogue and open tickets", async () => {
    await createTicket(ctx, PRIYA);
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/authors', headers: await admin() });
    expect(res.statusCode).toBe(200);
    const priya = res.json().data.find((a: { externalId: string }) => a.externalId === 'AUTH001');
    expect(priya).toMatchObject({
      bookCount: 2,
      liveBooks: 2,
      copiesSold: 342 + 189,
      royaltyEarned: { amountMinor: 1_197_000 + 793_800 },
      royaltyPending: { amountMinor: 357_000 },
      openTickets: 1,
    });
    const sneha = res.json().data.find((a: { externalId: string }) => a.externalId === 'AUTH007');
    expect(sneha).toMatchObject({ bookCount: 3, liveBooks: 2, openTickets: 0 });
  });

  it('shows one author with their books and tickets', async () => {
    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/admin/authors',
      headers: await admin(),
    });
    const priya = list.json().data.find((a: { externalId: string }) => a.externalId === 'AUTH001');
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/admin/authors/${priya.id}`,
      headers: await admin(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().books).toHaveLength(2);
    expect(res.json().tickets.length).toBeGreaterThanOrEqual(1);
    expect(res.json().copiesSold).toBe(531);
  });
});

describe('knowledge base', () => {
  it('versions an edited policy section and keeps history', async () => {
    const h = await admin();
    const sections = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/admin/knowledge-base/sections',
      headers: h,
    });
    const royalty = sections.json().data.find((s: { slug: string }) => s.slug === 'royalty-policy');
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/knowledge-base/sections/${royalty.id}`,
      headers: h,
      payload: { body: `${royalty.body}\n- Payout statements are emailed on the day of transfer.` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      version: royalty.version + 1,
      updatedBy: { displayName: 'Aarav Mehta' },
    });
    expect(ctx.queue.sent.some((j) => j.name === 'kb.embed')).toBe(true);
  });

  it('lets the team switch calibration examples on and off', async () => {
    const h = await admin();
    const examples = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/admin/knowledge-base/examples',
      headers: h,
    });
    expect(examples.json().data).toHaveLength(7);
    const first = examples.json().data[0];
    const off = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/knowledge-base/examples/${first.id}`,
      headers: h,
      payload: { isActive: false },
    });
    expect(off.statusCode).toBe(204);
  });
});

describe('insights and alerts', () => {
  it('reports support and AI metrics for the period', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/admin/insights?days=30',
      headers: await admin(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tickets.daily).toHaveLength(30);
    expect(res.json().range.days).toBe(30);
  });

  it('rejects an out-of-range period', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/admin/insights?days=365',
      headers: await admin(),
    });
    expect(res.statusCode).toBe(422);
  });

  it('raises a spike alert when one category floods in', async () => {
    for (let i = 0; i < 5; i += 1) {
      await createTicket(ctx, PRIYA, {
        subject: `Book unavailable on Amazon ${i}`,
        description: 'My book shows currently unavailable on Amazon India and readers cannot buy it.',
      });
    }
    await ctx.queue.drain();
    await ctx.container.alerts.scan();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/alerts', headers: await admin() });
    const spike = res.json().data.find((a: { kind: string }) => a.kind === 'category_spike');
    expect(spike).toMatchObject({ category: 'distribution_availability', status: 'open' });
    expect(spike.ticketCount).toBeGreaterThanOrEqual(5);

    const ack = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/alerts/${spike.id}`,
      headers: await admin(),
      payload: { status: 'acknowledged' },
    });
    expect(ack.statusCode).toBe(204);
  });
});
