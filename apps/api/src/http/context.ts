import type { UserRole } from '@bookleaf/contracts';
import type { Actor } from '@bookleaf/db';
// Load the plugins' type augmentations (request.cookies, reply.setCookie, route `config.rateLimit`).
import type {} from '@fastify/cookie';
import type {} from '@fastify/rate-limit';

/** The authenticated caller, resolved once per request by the auth hook. */
export interface RequestActor {
  userId: string;
  profileId: string;
  role: UserRole;
  /** Set for authors only. */
  authorId: string | null;
  displayName: string;
  title: string | null;
  email: string;
  /** Identity the database transaction runs as (drives row-level security). */
  db: Actor;
}

export interface RequestSession {
  via: 'cookie' | 'bearer';
  token: string;
  expiresAt: Date;
}

declare module 'fastify' {
  interface FastifyRequest {
    actor: RequestActor | null;
    session: RequestSession | null;
  }
}

/** Narrowing helper for handlers behind the auth hook. */
export function actorOf(request: { actor: RequestActor | null }): RequestActor {
  if (!request.actor) throw new Error('actorOf() called on an unauthenticated route');
  return request.actor;
}

export function authorIdOf(actor: RequestActor): string {
  if (!actor.authorId) throw new Error('Author route reached by a non-author actor');
  return actor.authorId;
}
