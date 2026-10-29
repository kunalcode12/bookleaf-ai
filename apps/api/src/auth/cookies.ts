import type { UserRole } from '@bookleaf/contracts';
import type { FastifyReply } from 'fastify';
import type { IdentitySession } from './identity';

export const REFRESH_COOKIE_PATH = '/api/v1/auth';
const REFRESH_MAX_AGE_SECONDS = 30 * 24 * 3600;

/**
 * Cookie names. With HTTPS the `__Host-` / `__Secure-` prefixes make browsers enforce Secure,
 * host-only scope and (for __Host-) Path=/ — a stolen subdomain cannot overwrite the session.
 */
export function cookieNames(secure: boolean) {
  return {
    access: secure ? '__Host-bl_at' : 'bl_at',
    refresh: secure ? '__Secure-bl_rt' : 'bl_rt',
    /** Non-sensitive UI hint so the web app can route authors and admins before the API answers. */
    role: 'bl_role',
  };
}

export function setSessionCookies(
  reply: FastifyReply,
  session: IdentitySession,
  role: UserRole,
  secure: boolean,
) {
  const names = cookieNames(secure);
  const accessMaxAge = Math.max(60, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
  reply.setCookie(names.access, session.accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: accessMaxAge,
  });
  reply.setCookie(names.refresh, session.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_MAX_AGE_SECONDS,
  });
  reply.setCookie(names.role, role, {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: REFRESH_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookies(reply: FastifyReply, secure: boolean) {
  const names = cookieNames(secure);
  reply.clearCookie(names.access, { path: '/', secure, httpOnly: true, sameSite: 'lax' });
  reply.clearCookie(names.refresh, { path: REFRESH_COOKIE_PATH, secure, httpOnly: true, sameSite: 'lax' });
  reply.clearCookie(names.role, { path: '/', secure, sameSite: 'lax' });
}
