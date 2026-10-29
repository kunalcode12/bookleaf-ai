import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { DatabaseHandle } from '@bookleaf/db';
import { errors as joseErrors, jwtVerify, SignJWT } from 'jose';
import type { Clock } from '../lib/clock';
import { AppError, Errors } from '../lib/errors';
import type { IdentityProvider, IdentitySession, VerifiedToken } from './identity';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const ISSUER = 'bookleaf-local';
const AUDIENCE = 'bookleaf-api';
const REFRESH_TTL_DAYS = 30;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64url'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** A real (constant-time) hash to compare against when the email is unknown — no user enumeration. */
const DUMMY_HASH =
  'scrypt$c2FsdHNhbHRzYWx0c2FsdA$ZHVtbXlkdW1teWR1bW15ZHVtbXlkdW1teWR1bW15ZHVtbXlkdW1teWR1bW15ZHVtbXlkdW1teWR1bW15';

/**
 * Embedded identity provider for local development and automated tests (never production —
 * config validation rejects it). Same contract as Supabase: scrypt password hashes, short-lived
 * HS256 access tokens, rotating hashed refresh tokens. Lives in its own `app_local` schema.
 */
export class LocalIdentityProvider implements IdentityProvider {
  readonly kind = 'local' as const;
  private readonly key: Uint8Array;

  constructor(
    private readonly handle: DatabaseHandle,
    secret: string,
    private readonly accessTtlSeconds: number,
    private readonly clock: Clock,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async init(): Promise<void> {
    await this.handle.query('create schema if not exists app_local');
    await this.handle.query(`create table if not exists app_local.identities (
      user_id uuid primary key,
      email text not null unique,
      password_hash text not null,
      created_at timestamptz not null default now()
    )`);
    await this.handle.query(`create table if not exists app_local.refresh_tokens (
      token_hash text primary key,
      user_id uuid not null references app_local.identities(user_id) on delete cascade,
      expires_at timestamptz not null,
      revoked_at timestamptz,
      created_at timestamptz not null default now()
    )`);
  }

  private async issue(userId: string): Promise<IdentitySession> {
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.accessTtlSeconds * 1000);
    const accessToken = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.key);
    const refreshToken = randomBytes(32).toString('base64url');
    await this.handle.query(
      'insert into app_local.refresh_tokens (token_hash, user_id, expires_at) values ($1, $2, $3)',
      [sha256(refreshToken), userId, new Date(now.getTime() + REFRESH_TTL_DAYS * 86_400_000)],
    );
    return { userId, accessToken, refreshToken, expiresAt };
  }

  async signIn(email: string, password: string): Promise<IdentitySession> {
    const [row] = await this.handle.query<{ user_id: string; password_hash: string }>(
      'select user_id, password_hash from app_local.identities where lower(email) = lower($1)',
      [email],
    );
    const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !ok) throw Errors.invalidCredentials();
    return this.issue(row.user_id);
  }

  async refresh(refreshToken: string): Promise<IdentitySession> {
    const now = this.clock.now();
    const [row] = await this.handle.query<{ user_id: string }>(
      `update app_local.refresh_tokens set revoked_at = $2
        where token_hash = $1 and revoked_at is null and expires_at > $2
        returning user_id`,
      [sha256(refreshToken), now],
    );
    if (!row) throw Errors.unauthenticated('Your session has ended. Please sign in again.');
    return this.issue(row.user_id);
  }

  async signOut(session: { refreshToken?: string | null }): Promise<void> {
    if (!session.refreshToken) return;
    await this.handle.query('update app_local.refresh_tokens set revoked_at = now() where token_hash = $1', [
      sha256(session.refreshToken),
    ]);
  }

  async verify(accessToken: string): Promise<VerifiedToken> {
    try {
      const { payload } = await jwtVerify(accessToken, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
        currentDate: this.clock.now(),
      });
      if (!payload.sub || !payload.exp) throw Errors.unauthenticated('Malformed session token.');
      return { userId: payload.sub, expiresAt: new Date(payload.exp * 1000) };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof joseErrors.JWTExpired) throw Errors.tokenExpired();
      throw Errors.unauthenticated('Your session is invalid. Please sign in again.');
    }
  }

  async ensureUser(email: string, password: string): Promise<{ userId: string; created: boolean }> {
    const hash = await hashPassword(password);
    const [existing] = await this.handle.query<{ user_id: string }>(
      'update app_local.identities set password_hash = $2 where lower(email) = lower($1) returning user_id',
      [email, hash],
    );
    if (existing) return { userId: existing.user_id, created: false };
    const userId = randomUUID();
    await this.handle.query(
      'insert into app_local.identities (user_id, email, password_hash) values ($1, $2, $3)',
      [userId, email.toLowerCase(), hash],
    );
    return { userId, created: true };
  }
}
