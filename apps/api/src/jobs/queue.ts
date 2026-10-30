import { APP_DB_ROLE, type DatabaseHandle, type Transaction } from '@bookleaf/db';
import { sql } from 'drizzle-orm';
import { type DrizzleTransactionLike, fromDrizzle, fromPglite, PgBoss } from 'pg-boss';
import type { Logger } from 'pino';
import { defaultSingletonKey, type JobName, type JobPayloads, QUEUES } from './definitions';

export interface EnqueueOptions {
  startAfterSeconds?: number;
  /** Drops the job if one with the same key is already queued (de-duplication). */
  singletonKey?: string;
  /** Enqueue inside this transaction: the job exists only if the transaction commits. */
  tx?: Transaction;
}

export type JobHandler<N extends JobName> = (
  data: JobPayloads[N],
  meta: { retryCount: number },
) => Promise<void>;

export interface JobQueue {
  readonly kind: 'pg-boss' | 'memory';
  start(): Promise<void>;
  stop(): Promise<void>;
  send<N extends JobName>(name: N, data: JobPayloads[N], options?: EnqueueOptions): Promise<void>;
  work<N extends JobName>(name: N, handler: JobHandler<N>): Promise<void>;
  schedule(name: JobName, cron: string): Promise<void>;
}

/**
 * Durable jobs in Postgres via pg-boss — no Redis to run. Jobs can be enqueued inside the same
 * transaction that creates the ticket (transactional outbox without the outbox table), retries
 * use exponential backoff, and the embedded PGlite database works through pg-boss's adapter.
 */
export class PgBossQueue implements JobQueue {
  readonly kind = 'pg-boss' as const;
  private readonly boss: PgBoss;

  constructor(handle: DatabaseHandle, logger: Logger) {
    this.boss = handle.pglite
      ? new PgBoss({ db: fromPglite(handle.pglite), schema: 'pgboss' })
      : new PgBoss({
          connectionString: handle.connectionString ?? undefined,
          schema: 'pgboss',
          // Small: Supabase's session pooler allows ~15 connections per project in total.
          max: 2,
          application_name: 'bookleaf-jobs',
        });
    this.boss.on('error', (error) => logger.error({ err: error }, 'job queue error'));
  }

  async start(): Promise<void> {
    await this.boss.start();
    const existing = new Set((await this.boss.getQueues()).map((q) => q.name));
    for (const [name, settings] of Object.entries(QUEUES)) {
      if (existing.has(name)) continue;
      await this.boss.createQueue(name, {
        policy: settings.policy,
        retryLimit: settings.retryLimit,
        retryDelay: settings.retryDelay,
        retryBackoff: settings.retryBackoff,
        expireInSeconds: settings.expireInSeconds,
      });
    }
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 10_000 });
  }

  async send<N extends JobName>(name: N, data: JobPayloads[N], options: EnqueueOptions = {}): Promise<void> {
    const singletonKey = options.singletonKey ?? defaultSingletonKey(name, data);
    const sendOptions = {
      ...(options.startAfterSeconds ? { startAfter: options.startAfterSeconds } : {}),
      ...(singletonKey ? { singletonKey } : {}),
    };
    const { tx } = options;
    if (!tx) {
      await this.boss.send(name, data, sendOptions);
      return;
    }
    // The application transaction runs as the restricted RLS role, which has no rights on the
    // pg-boss schema. Step back to the session role just for the enqueue, then restore it.
    await tx.execute(sql.raw('reset role'));
    try {
      // Drizzle's transaction satisfies the adapter at runtime; its `execute` is typed more loosely.
      await this.boss.send(name, data, {
        ...sendOptions,
        db: fromDrizzle(tx as unknown as DrizzleTransactionLike, sql),
      });
    } finally {
      await tx.execute(sql.raw(`set local role ${APP_DB_ROLE}`));
    }
  }

  async work<N extends JobName>(name: N, handler: JobHandler<N>): Promise<void> {
    const settings = QUEUES[name];
    await this.boss.work<JobPayloads[N]>(
      name,
      { batchSize: 1, localConcurrency: settings.concurrency, pollingIntervalSeconds: 2 },
      async (jobs) => {
        for (const job of jobs) await handler(job.data, { retryCount: job.retryCount });
      },
    );
  }

  async schedule(name: JobName, cron: string): Promise<void> {
    await this.boss.schedule(name, cron, {}, { tz: 'UTC' });
  }
}

/**
 * In-process queue for tests: jobs are collected and run on `drain()`, deterministically and in
 * order. (Not transactional — fine for tests, never used in production.)
 */
export class MemoryJobQueue implements JobQueue {
  readonly kind = 'memory' as const;
  readonly sent: Array<{ name: JobName; data: unknown }> = [];
  private pending: Array<{ name: JobName; data: unknown; key?: string }> = [];
  private readonly handlers = new Map<JobName, JobHandler<JobName>>();

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  async send<N extends JobName>(name: N, data: JobPayloads[N], options: EnqueueOptions = {}): Promise<void> {
    const key = options.singletonKey ?? defaultSingletonKey(name, data);
    if (key && this.pending.some((j) => j.key === key)) return;
    this.sent.push({ name, data });
    if (!options.startAfterSeconds) this.pending.push({ name, data, key });
  }

  async work<N extends JobName>(name: N, handler: JobHandler<N>): Promise<void> {
    this.handlers.set(name, handler as unknown as JobHandler<JobName>);
  }

  async schedule(): Promise<void> {}

  /** Runs queued jobs (and any they enqueue) until the queue is empty. */
  async drain(maxRounds = 20): Promise<number> {
    let ran = 0;
    for (let round = 0; round < maxRounds && this.pending.length > 0; round += 1) {
      const batch = this.pending;
      this.pending = [];
      for (const job of batch) {
        const handler = this.handlers.get(job.name);
        if (!handler) continue;
        await handler(job.data as never, { retryCount: 0 });
        ran += 1;
      }
    }
    return ran;
  }

  clear(): void {
    this.pending = [];
    this.sent.length = 0;
  }
}
