import { type SQL, sql } from 'drizzle-orm';

/**
 * A point in time as a `timestamptz` parameter for raw `sql` fragments. Always use this instead of
 * interpolating a `Date`: Drizzle's postgres-js driver passes timestamp parameters through
 * untouched and the wire encoder expects strings, so a raw `Date` crashes the query on real
 * Postgres (PGlite happens to accept it, which is why tests alone wouldn't catch it).
 */
export function tstz(date: Date): SQL {
  return sql`${date.toISOString()}::timestamptz`;
}
