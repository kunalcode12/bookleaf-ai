import { Errors } from './errors';

/**
 * Opaque pagination cursor. Encodes an offset plus a fingerprint of the query it belongs to, so a
 * cursor can't be replayed against a different filter/sort. Offsets keep time-dependent sorts
 * (urgency changes as tickets age) consistent; switch to keyset cursors if volume demands it.
 */
interface CursorPayload {
  o: number;
  f: string;
}

export function encodeCursor(offset: number, fingerprint: string): string {
  return Buffer.from(JSON.stringify({ o: offset, f: fingerprint } satisfies CursorPayload)).toString(
    'base64url',
  );
}

export function decodeCursor(cursor: string | undefined, fingerprint: string): number {
  if (!cursor) return 0;
  try {
    const payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as CursorPayload;
    if (typeof payload.o !== 'number' || payload.o < 0 || payload.f !== fingerprint)
      throw new Error('mismatch');
    return Math.floor(payload.o);
  } catch {
    throw Errors.badRequest('Invalid or expired pagination cursor. Start again from the first page.');
  }
}

export function fingerprintOf(value: unknown): string {
  const text = JSON.stringify(value, Object.keys(value as object).sort());
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}
