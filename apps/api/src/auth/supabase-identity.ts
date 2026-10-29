import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { createRemoteJWKSet, decodeProtectedHeader, errors as joseErrors, jwtVerify } from 'jose';
import { AppError, Errors } from '../lib/errors';
import type { IdentityProvider, IdentitySession, VerifiedToken } from './identity';

const AUTH_OPTIONS = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

function toSession(session: Session): IdentitySession {
  const expiresAtSeconds = session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in;
  return {
    userId: session.user.id,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: new Date(expiresAtSeconds * 1000),
  };
}

/**
 * Supabase Auth behind BookLeaf's own /auth endpoints. Access tokens are verified locally
 * against the project's published signing keys (JWKS, cached) — no network call per request.
 * Projects still on legacy HS256 signing verify with SUPABASE_JWT_SECRET instead.
 */
export class SupabaseIdentityProvider implements IdentityProvider {
  readonly kind = 'supabase' as const;
  private readonly publicClient: SupabaseClient;
  private readonly adminClient: SupabaseClient;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;
  private readonly legacySecret: Uint8Array | null;

  constructor(options: { url: string; publishableKey: string; secretKey: string; jwtSecret: string | null }) {
    this.publicClient = createClient(options.url, options.publishableKey, { auth: AUTH_OPTIONS });
    this.adminClient = createClient(options.url, options.secretKey, { auth: AUTH_OPTIONS });
    this.jwks = createRemoteJWKSet(new URL(`${options.url}/auth/v1/.well-known/jwks.json`), {
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    });
    this.issuer = `${options.url}/auth/v1`;
    this.legacySecret = options.jwtSecret ? new TextEncoder().encode(options.jwtSecret) : null;
  }

  async signIn(email: string, password: string): Promise<IdentitySession> {
    const { data, error } = await this.publicClient.auth.signInWithPassword({ email, password });
    if (data.session && !error) return toSession(data.session);
    if (error?.status === 429) throw Errors.rateLimited(60);
    if (error && (error.status === 400 || error.code === 'invalid_credentials'))
      throw Errors.invalidCredentials();
    throw Errors.unavailable('Sign-in is temporarily unavailable. Please try again in a moment.');
  }

  async refresh(refreshToken: string): Promise<IdentitySession> {
    const { data, error } = await this.publicClient.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) throw Errors.unauthenticated('Your session has ended. Please sign in again.');
    return toSession(data.session);
  }

  async signOut(session: { accessToken?: string | null }): Promise<void> {
    if (!session.accessToken) return;
    await this.adminClient.auth.admin.signOut(session.accessToken, 'local').catch(() => undefined);
  }

  async verify(accessToken: string): Promise<VerifiedToken> {
    try {
      const { alg } = decodeProtectedHeader(accessToken);
      const options = { issuer: this.issuer, audience: 'authenticated' };
      let payload: { sub?: string; exp?: number };
      if (alg === 'HS256') {
        if (!this.legacySecret) throw Errors.unauthenticated('Unsupported session token.');
        ({ payload } = await jwtVerify(accessToken, this.legacySecret, options));
      } else {
        ({ payload } = await jwtVerify(accessToken, this.jwks, options));
      }
      if (!payload.sub || !payload.exp) throw Errors.unauthenticated('Malformed session token.');
      return { userId: payload.sub, expiresAt: new Date(payload.exp * 1000) };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof joseErrors.JWTExpired) throw Errors.tokenExpired();
      throw Errors.unauthenticated('Your session is invalid. Please sign in again.');
    }
  }

  async ensureUser(email: string, password: string): Promise<{ userId: string; created: boolean }> {
    const { data, error } = await this.adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (!error && data.user) return { userId: data.user.id, created: true };
    const existing = await this.findUserIdByEmail(email);
    if (!existing)
      throw new Error(`Could not create or find Supabase user ${email}: ${error?.message ?? 'unknown'}`);
    const update = await this.adminClient.auth.admin.updateUserById(existing, {
      password,
      email_confirm: true,
    });
    if (update.error) throw new Error(`Could not update Supabase user ${email}: ${update.error.message}`);
    return { userId: existing, created: false };
  }

  private async findUserIdByEmail(email: string): Promise<string | null> {
    const target = email.toLowerCase();
    for (let page = 1; page <= 25; page += 1) {
      const { data, error } = await this.adminClient.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(`Could not list Supabase users: ${error.message}`);
      const match = data.users.find((u) => u.email?.toLowerCase() === target);
      if (match) return match.id;
      if (data.users.length < 200) break;
    }
    return null;
  }
}
