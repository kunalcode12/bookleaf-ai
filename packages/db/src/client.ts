import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Schema = typeof schema;
export type Database = PgDatabase<PgQueryResultHKT, Schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Anything that can run queries: the database itself or an open transaction. */
export type Executor = Database | Transaction;

export interface DatabaseOptions {
  /**
   * `postgres://…` / `postgresql://…` for a real server (Supabase: use the session pooler, port 5432),
   * `pglite://<dir>` for an embedded on-disk database, or `pglite://memory` for tests.
   */
  url: string;
  poolMax?: number;
  applicationName?: string;
}

export interface DatabaseHandle {
  readonly db: Database;
  readonly driver: 'postgres' | 'pglite';
  /** The embedded instance in local mode (pg-boss attaches to it through its PGlite adapter). */
  readonly pglite: PGlite | null;
  readonly connectionString: string | null;
  /** Raw parameterised SQL, rows normalised across drivers. Prefer the query builder. */
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  listen(channel: string, onPayload: (payload: string) => void): Promise<() => Promise<void>>;
  notify(channel: string, payload: string): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export async function createDatabase(options: DatabaseOptions): Promise<DatabaseHandle> {
  return options.url.startsWith('pglite://') ? createPglite(options) : createPostgres(options);
}

/** The slice of a postgres-js client (or transaction/savepoint scope) that Drizzle drives. */
interface ScopedClient {
  unsafe(query: string, parameters?: unknown[], options?: { prepare?: boolean }): unknown;
  begin?: (...args: unknown[]) => unknown;
  savepoint?: (...args: unknown[]) => unknown;
}

/**
 * Drizzle sends every query through postgres-js `unsafe()`, which defaults to unnamed statements:
 * each parameterised query then waits for a describe round trip before it can execute, and the
 * queries behind it can't pipeline — so a transaction's Promise.all ran one query at a time, two
 * round trips each. Named statements are described once per connection; after that a query costs
 * a single round trip and concurrent queries share one. Transactions and savepoints hand Drizzle
 * a fresh scoped client, so those are switched over as they open.
 */
function preferPreparedStatements(client: ScopedClient): void {
  const unsafe = client.unsafe;
  client.unsafe = (query, parameters, options) => unsafe(query, parameters, { ...options, prepare: true });
  for (const method of ['begin', 'savepoint'] as const) {
    const open = client[method];
    if (!open) continue;
    client[method] = (...args: unknown[]) => {
      const work = args.pop() as (scoped: ScopedClient) => unknown;
      return open(...args, (scoped: ScopedClient) => {
        preferPreparedStatements(scoped);
        return work(scoped);
      });
    };
  }
}

function createPostgres(options: DatabaseOptions): DatabaseHandle {
  // Supabase's transaction pooler (6543) cannot hold prepared statements or LISTEN.
  const transactionPooler = /:6543(\/|$|\?)/.test(options.url);
  const client = postgres(options.url, {
    max: options.poolMax ?? 10,
    prepare: !transactionPooler,
    // Long enough to outlast a reader's pause: a fresh connection costs a TLS + SCRAM handshake
    // and re-describes every statement it runs.
    idle_timeout: 120,
    connect_timeout: 10,
    onnotice: () => {},
    connection: { application_name: options.applicationName ?? 'bookleaf-api' },
  });
  if (!transactionPooler) preferPreparedStatements(client as unknown as ScopedClient);
  const db = drizzlePostgres({ client, schema }) as unknown as Database;

  return {
    db,
    driver: 'postgres',
    pglite: null,
    connectionString: options.url,
    async query<T>(text: string, params: unknown[] = []) {
      return (await client.unsafe(text, params as postgres.ParameterOrJSON<never>[])) as unknown as T[];
    },
    async listen(channel, onPayload) {
      const subscription = await client.listen(channel, onPayload);
      return async () => {
        await subscription.unlisten();
      };
    },
    async notify(channel, payload) {
      await client.notify(channel, payload);
    },
    async ping() {
      try {
        await client`select 1`;
        return true;
      } catch {
        return false;
      }
    },
    async close() {
      await client.end({ timeout: 5 });
    },
  };
}

async function createPglite(options: DatabaseOptions): Promise<DatabaseHandle> {
  const target = options.url.slice('pglite://'.length);
  const inMemory = target === '' || target === 'memory';
  const pglite = inMemory
    ? new PGlite({ extensions: { vector } })
    : new PGlite(path.resolve(target), { extensions: { vector } });
  await pglite.waitReady;
  const db = drizzlePglite({ client: pglite, schema }) as unknown as Database;

  return {
    db,
    driver: 'pglite',
    pglite,
    connectionString: null,
    async query<T>(text: string, params: unknown[] = []) {
      return (await pglite.query<T>(text, params)).rows;
    },
    async listen(channel, onPayload) {
      return pglite.listen(channel, onPayload);
    },
    async notify(channel, payload) {
      await pglite.query('select pg_notify($1, $2)', [channel, payload]);
    },
    async ping() {
      try {
        await pglite.query('select 1');
        return true;
      } catch {
        return false;
      }
    },
    async close() {
      await pglite.close();
    },
  };
}

/** `db.execute()` returns an array on postgres-js and `{ rows }` on PGlite; this unifies both. */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result) return (result as { rows: T[] }).rows;
  return [];
}
