import { sql } from 'drizzle-orm';
import type { Database, Transaction } from './client';

/**
 * Who a database transaction acts for. Mirrors the identities the RLS policies understand:
 * authors see their own rows, admins and the background worker ("system") see everything.
 */
export type Actor =
  | { kind: 'author'; profileId: string; authorId: string }
  | { kind: 'admin'; profileId: string }
  | { kind: 'system' };

export const SYSTEM_ACTOR: Actor = { kind: 'system' };

export interface ActorTransactionOptions {
  readOnly?: boolean;
}

/** Restricted role every application transaction switches to (created in migration 0002). */
export const APP_DB_ROLE = 'bookleaf_app';

/**
 * Runs `work` in a transaction bound to `actor`:
 *   1. records the actor in transaction-local settings read by the RLS policies, then
 *   2. drops to the restricted `bookleaf_app` role, so RLS applies even though the pool connects
 *      as the table owner.
 * Both settings vanish at COMMIT/ROLLBACK, so pooled connections never leak identity.
 *
 * The setup is a single statement — one round trip — because every request pays it:
 * set_config('role', …, true) is SET LOCAL ROLE, and set_config('transaction_read_only', 'on',
 * true) is SET TRANSACTION READ ONLY. The role switch comes last, after the settings it guards.
 */
export async function withActor<T>(
  db: Database,
  actor: Actor,
  work: (tx: Transaction) => Promise<T>,
  options: ActorTransactionOptions = {},
): Promise<T> {
  return db.transaction(async (tx) => {
    const profileId = actor.kind === 'system' ? '' : actor.profileId;
    const authorId = actor.kind === 'author' ? actor.authorId : '';
    const readOnly = options.readOnly ? sql`set_config('transaction_read_only', 'on', true),` : sql.empty();
    await tx.execute(
      sql`select set_config('app.actor_role', ${actor.kind}, true), set_config('app.actor_id', ${profileId}, true), set_config('app.actor_author_id', ${authorId}, true), ${readOnly} set_config('role', ${APP_DB_ROLE}, true)`,
    );
    return work(tx);
  });
}
