import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import type { DatabaseHandle, Schema } from './client';

/**
 * Finds the SQL migrations whether running from source (packages/db/src → ../migrations) or from
 * the API bundle (dist/main.js → ./migrations, copied at build time). DB_MIGRATIONS_DIR overrides.
 */
export function resolveMigrationsFolder(): string {
  const here = import.meta.url;
  const candidates = [
    process.env.DB_MIGRATIONS_DIR,
    fileURLToPath(new URL('../migrations', here)),
    fileURLToPath(new URL('./migrations', here)),
    path.resolve(process.cwd(), 'migrations'),
  ].filter((c): c is string => Boolean(c));
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'meta', '_journal.json'))) return candidate;
  }
  throw new Error(
    `Database migrations not found (looked in: ${candidates.join(', ')}). Set DB_MIGRATIONS_DIR.`,
  );
}

export async function runMigrations(handle: DatabaseHandle, migrationsFolder = resolveMigrationsFolder()) {
  const config = { migrationsFolder, migrationsSchema: 'drizzle', migrationsTable: '__migrations' };
  if (handle.driver === 'pglite') {
    await migratePglite(handle.db as unknown as PgliteDatabase<Schema>, config);
  } else {
    await migratePostgres(handle.db as unknown as PostgresJsDatabase<Schema>, config);
  }
}
