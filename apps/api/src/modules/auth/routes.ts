import {
  type DemoAccountsResponse,
  DemoAccountsResponseSchema,
  LoginRequestSchema,
  RefreshRequestSchema,
  SessionResponseSchema,
  TokenResponseSchema,
} from '@bookleaf/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { clearSessionCookies, cookieNames, setSessionCookies } from '../../auth/cookies';
import type { IdentityProvider, IdentitySession } from '../../auth/identity';
import type { Config } from '../../config/env';
import { actorOf } from '../../http/context';
import { Errors } from '../../lib/errors';
import type { ProfileRecord, ProfileService } from '../profiles/service';

const TAG = 'Auth';

interface AuthDeps {
  identity: IdentityProvider;
  profiles: ProfileService;
  config: Config;
  demoAccounts: () => DemoAccountsResponse;
}

/** Throttles credential stuffing per IP *and* per account. */
const loginRateLimit = {
  rateLimit: {
    max: 10,
    timeWindow: '5 minutes',
    hook: 'preHandler' as const,
    keyGenerator: (request: { ip: string; body?: unknown }) =>
      `${request.ip}:${String((request.body as { email?: string } | undefined)?.email ?? '').toLowerCase()}`,
  },
};

export const authRoutes: FastifyPluginAsyncZod<AuthDeps> = async (app, deps) => {
  const { identity, profiles, config } = deps;
  const names = cookieNames(config.cookieSecure);

  async function establish(session: IdentitySession): Promise<ProfileRecord> {
    profiles.invalidate(session.userId);
    const profile = await profiles.byUserId(session.userId);
    if (!profile) {
      await identity.signOut(session).catch(() => undefined);
      throw Errors.forbidden('This login is not linked to a BookLeaf account.');
    }
    profiles.touch(profile.id).catch(() => undefined);
    return profile;
  }

  app.post(
    '/login',
    {
      config: loginRateLimit,
      schema: {
        tags: [TAG],
        summary: 'Sign in (browser): sets httpOnly session cookies',
        security: [],
        body: LoginRequestSchema,
        response: { 200: SessionResponseSchema },
      },
    },
    async (request, reply) => {
      const session = await identity.signIn(request.body.email.trim(), request.body.password);
      const profile = await establish(session);
      setSessionCookies(reply, session, profile.role, config.cookieSecure);
      return { user: profiles.toSessionUser(profile), expiresAt: session.expiresAt.toISOString() };
    },
  );

  app.post(
    '/token',
    {
      config: loginRateLimit,
      schema: {
        tags: [TAG],
        summary: 'Sign in (API clients): returns a bearer token',
        description:
          'Use the `accessToken` as `Authorization: Bearer <token>`. Refresh with POST /auth/refresh {refreshToken}.',
        security: [],
        body: LoginRequestSchema,
        response: { 200: TokenResponseSchema },
      },
    },
    async (request) => {
      const session = await identity.signIn(request.body.email.trim(), request.body.password);
      const profile = await establish(session);
      return {
        tokenType: 'Bearer' as const,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt.toISOString(),
        user: profiles.toSessionUser(profile),
      };
    },
  );

  app.post(
    '/refresh',
    {
      schema: {
        tags: [TAG],
        summary: 'Refresh the session (cookie, or `refreshToken` in the body for API clients)',
        security: [],
        body: RefreshRequestSchema.optional(),
        response: { 200: z.union([TokenResponseSchema, SessionResponseSchema]) },
      },
    },
    async (request, reply) => {
      const bodyToken = request.body?.refreshToken;
      const token = bodyToken ?? request.cookies[names.refresh];
      if (!token) throw Errors.unauthenticated('Your session has ended. Please sign in again.');
      const session = await identity.refresh(token);
      const profile = await establish(session);
      if (bodyToken) {
        return {
          tokenType: 'Bearer' as const,
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          expiresAt: session.expiresAt.toISOString(),
          user: profiles.toSessionUser(profile),
        };
      }
      setSessionCookies(reply, session, profile.role, config.cookieSecure);
      return { user: profiles.toSessionUser(profile), expiresAt: session.expiresAt.toISOString() };
    },
  );

  app.post(
    '/logout',
    {
      schema: {
        tags: [TAG],
        summary: 'Sign out and revoke the refresh token',
        security: [],
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await identity
        .signOut({
          accessToken: request.cookies[names.access] ?? null,
          refreshToken: request.cookies[names.refresh] ?? null,
        })
        .catch(() => undefined);
      clearSessionCookies(reply, config.cookieSecure);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/demo-accounts',
    {
      schema: {
        tags: [TAG],
        summary: 'Demo personas for evaluators (demo mode only)',
        security: [],
        response: { 200: DemoAccountsResponseSchema },
      },
    },
    async () => deps.demoAccounts(),
  );
};

/** GET /auth/session — registered behind the auth hook. */
export const sessionRoutes: FastifyPluginAsyncZod<{ profiles: ProfileService }> = async (
  app,
  { profiles },
) => {
  app.get(
    '/auth/session',
    { schema: { tags: [TAG], summary: 'The signed-in user', response: { 200: SessionResponseSchema } } },
    async (request) => {
      const actor = actorOf(request);
      const profile = await profiles.byUserId(actor.userId);
      if (!profile) throw Errors.forbidden('This login is not linked to a BookLeaf account.');
      return {
        user: profiles.toSessionUser(profile),
        expiresAt: (request.session?.expiresAt ?? new Date()).toISOString(),
      };
    },
  );
};
