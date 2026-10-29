import { createLeaf, type Leaf } from '@bookleaf/ai';
import { createDatabase } from '@bookleaf/db';
import { pino } from 'pino';
import { type App, buildApp } from '../src/app';
import { loadConfig } from '../src/config/env';
import { type Container, createContainer } from '../src/container';
import { MemoryJobQueue } from '../src/jobs/queue';
import { fixedClock } from '../src/lib/clock';
import { seedDatabase } from '../src/seed/seed';

export const NOW = new Date('2026-10-29T10:00:00Z');
export const ORIGIN = 'http://localhost:3000';
export const ADMIN = { email: 'aarav.mehta@bookleaf.test', password: 'BookLeaf@Admin1' };
export const ADMIN_2 = { email: 'isha.verma@bookleaf.test', password: 'BookLeaf@Admin1' };
export const PRIYA = { email: 'priya.sharma@email.com', password: 'BookLeaf@Author1' };
export const ROHIT = { email: 'rohit.kapoor@email.com', password: 'BookLeaf@Author1' };

export interface TestContext {
  app: App;
  container: Container;
  queue: MemoryJobQueue;
  clock: ReturnType<typeof fixedClock>;
  token(credentials: { email: string; password: string }): Promise<string>;
  close(): Promise<void>;
}

/**
 * Boots the real application (every plugin, route and service) against a fresh in-memory
 * Postgres with migrations and RLS, local auth, an in-process job queue and a fixed clock.
 */
export async function createTestContext(
  options: { leaf?: Leaf; demoTickets?: boolean } = {},
): Promise<TestContext> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'pglite://memory',
    LOG_LEVEL: 'silent',
    APP_ORIGINS: ORIGIN,
    PUBLIC_APP_URL: ORIGIN,
    LOCAL_STORAGE_DIR: './.data/test-uploads',
  });
  const logger = pino({ level: 'silent' });
  const clock = fixedClock(NOW);
  const queue = new MemoryJobQueue();
  const container = await createContainer(config, logger, {
    handle: await createDatabase({ url: 'pglite://memory' }),
    queue,
    clock,
    leaf: options.leaf ?? createLeaf({ now: () => clock.now() }),
  });
  await container.start({ withWorkers: true });
  await seedDatabase(container, { demoTickets: options.demoTickets ?? false });
  queue.clear();
  const app = await buildApp(container);
  await app.ready();

  const tokens = new Map<string, string>();
  return {
    app,
    container,
    queue,
    clock,
    async token(credentials) {
      const cached = tokens.get(credentials.email);
      if (cached) return cached;
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/token', payload: credentials });
      if (res.statusCode !== 200) throw new Error(`login failed for ${credentials.email}: ${res.body}`);
      const token = res.json().accessToken as string;
      tokens.set(credentials.email, token);
      return token;
    },
    async close() {
      await app.close();
      await container.stop();
    },
  };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export async function firstBookId(ctx: TestContext, credentials = PRIYA): Promise<string> {
  const res = await ctx.app.inject({
    method: 'GET',
    url: '/api/v1/me/books',
    headers: bearer(await ctx.token(credentials)),
  });
  return res.json().data[0].id;
}

export async function createTicket(
  ctx: TestContext,
  credentials = PRIYA,
  body: Partial<{ bookId: string | null; subject: string; description: string }> = {},
) {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/me/tickets',
    headers: bearer(await ctx.token(credentials)),
    payload: {
      bookId: null,
      subject: 'Royalty for Whispers of the Ganges',
      description:
        'My dashboard shows royalty pending since October. When will it be paid to my bank account?',
      attachmentIds: [],
      ...body,
    },
  });
  if (res.statusCode !== 201) throw new Error(`ticket creation failed: ${res.statusCode} ${res.body}`);
  return res.json() as { id: string; number: string; status: string };
}
