import type { UserRole } from '@bookleaf/contracts';
import type { FastifyRequest } from 'fastify';
import { cookieNames } from '../auth/cookies';
import type { IdentityProvider } from '../auth/identity';
import type { Config } from '../config/env';
import { Errors } from '../lib/errors';
import type { ProfileService } from '../modules/profiles/service';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Cookie-authenticated writes must come from an allowed origin. Combined with SameSite=Lax
 * cookies and JSON-only bodies this closes cross-site request forgery. Bearer-token clients
 * (Postman, scripts) are not exposed to CSRF and skip the check.
 */
function assertTrustedOrigin(request: FastifyRequest, config: Config) {
  const referer = request.headers.referer;
  let origin = request.headers.origin;
  if (!origin && referer) {
    try {
      origin = new URL(referer).origin;
    } catch {
      origin = undefined;
    }
  }
  if (!origin) throw Errors.csrf();
  const forwardedHost = request.headers['x-forwarded-host'];
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ?? request.headers.host;
  if (host && (origin === `https://${host}` || origin === `http://${host}`)) return;
  if (config.APP_ORIGINS.includes(origin)) return;
  throw Errors.csrf();
}

export function createAuthenticate(deps: {
  identity: IdentityProvider;
  profiles: ProfileService;
  config: Config;
}) {
  const names = cookieNames(deps.config.cookieSecure);

  return async function authenticate(request: FastifyRequest): Promise<void> {
    const header = request.headers.authorization;
    let token: string | undefined;
    let via: 'bearer' | 'cookie';
    if (header?.toLowerCase().startsWith('bearer ')) {
      token = header.slice(7).trim();
      via = 'bearer';
    } else {
      token = request.cookies[names.access];
      via = 'cookie';
    }
    if (!token) throw Errors.unauthenticated();
    if (via === 'cookie' && UNSAFE_METHODS.has(request.method)) assertTrustedOrigin(request, deps.config);

    const verified = await deps.identity.verify(token);
    const profile = await deps.profiles.byUserId(verified.userId);
    if (!profile) throw Errors.forbidden('This login is not linked to a BookLeaf account.');
    request.actor = deps.profiles.toActor(profile, verified.userId);
    request.session = { via, token, expiresAt: verified.expiresAt };
  };
}

/** Route-tree guard: registered once per plugin scope, so no handler can forget it. */
export function requireRole(role: UserRole) {
  return async function guard(request: FastifyRequest): Promise<void> {
    if (!request.actor) throw Errors.unauthenticated();
    if (request.actor.role !== role) {
      throw Errors.forbidden(
        role === 'admin' ? 'This area is for the BookLeaf team.' : 'This area is for authors.',
      );
    }
  };
}
