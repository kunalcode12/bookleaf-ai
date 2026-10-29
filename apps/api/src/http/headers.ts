import { z } from 'zod';
import { Errors } from '../lib/errors';

/** `Idempotency-Key` (UUID) for create endpoints; unrelated headers pass through untouched. */
export const IdempotencyHeadersSchema = z.looseObject({
  'idempotency-key': z.uuid({ message: 'Idempotency-Key must be a UUID' }).optional(),
});

/** Optional `If-Match` for optimistic concurrency on admin edits. */
export const IfMatchHeadersSchema = z.looseObject({
  'if-match': z.string().max(64).optional(),
});

export const etagFor = (version: number) => `W/"${version}"`;

/** Accepts `W/"12"`, `"12"` or `12`. Returns null when the header is absent. */
export function parseIfMatch(header: string | undefined): number | null {
  if (header === undefined) return null;
  const match = /^\s*(?:W\/)?"?(\d+)"?\s*$/.exec(header);
  if (!match) throw Errors.badRequest('If-Match must be the ETag returned by GET (e.g. W/"3").');
  return Number(match[1]);
}
