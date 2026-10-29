import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Container } from './container';
import { Errors } from './lib/errors';
import { aiRoutes } from './modules/ai/routes';
import { alertRoutes } from './modules/alerts/routes';
import { assistRoutes } from './modules/assist/routes';
import { localFileRoutes, uploadRequestRoutes } from './modules/attachments/routes';
import { authRoutes, sessionRoutes } from './modules/auth/routes';
import { authorRoutes } from './modules/authors/routes';
import { bookRoutes } from './modules/books/routes';
import { healthRoutes } from './modules/health/routes';
import { insightsRoutes } from './modules/insights/routes';
import { knowledgeRoutes } from './modules/knowledge/routes';
import { notificationRoutes } from './modules/notifications/routes';
import { realtimeRoutes } from './modules/realtime/routes';
import { adminTicketRoutes } from './modules/tickets/admin.routes';
import { authorTicketRoutes } from './modules/tickets/author.routes';
import { createAuthenticate, requireRole } from './plugins/auth';
import { docsPlugin } from './plugins/docs';
import { errorsPlugin } from './plugins/errors';
import { securityPlugin } from './plugins/security';
import { demoAccounts } from './seed/accounts';

const REQUEST_ID = /^[A-Za-z0-9._-]{8,80}$/;

/**
 * Builds the HTTP application. The route tree mirrors the access model: public auth routes,
 * then one authenticated scope split into `/me` (authors only) and `/admin` (BookLeaf team only),
 * each guarded once at the scope level so no individual handler can forget a check.
 */
export async function buildApp(container: Container) {
  const { config, logger } = container;

  const app = Fastify({
    loggerInstance: logger,
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 256 * 1024,
    requestIdHeader: false,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    },
    requestIdLogLabel: 'requestId',
    return503OnClosing: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('actor', null);
  app.decorateRequest('session', null);
  // Open SSE streams would otherwise hold the server open on shutdown.
  app.addHook('preClose', async () => {
    await container.hub.stop();
  });

  await app.register(errorsPlugin);
  await app.register(securityPlugin, { config });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    allowList: (request) => request.url.startsWith('/health'),
    errorResponseBuilder: (_request, context) =>
      Errors.rateLimited(Math.max(1, Math.ceil(context.ttl / 1000))),
  });
  await app.register(docsPlugin, { config });

  await app.register(healthRoutes, {
    handle: container.handle,
    hub: container.hub,
    leaf: container.leaf,
    workerInline: config.WORKER_MODE === 'inline',
  });

  const authenticate = createAuthenticate({
    identity: container.identity,
    profiles: container.profiles,
    config,
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes, {
        prefix: '/auth',
        identity: container.identity,
        profiles: container.profiles,
        config,
        demoAccounts: () => demoAccounts(config, container.clock.now()),
      });
      if (container.localStorage) await api.register(localFileRoutes, container.localStorage);

      // Everything below requires a valid session.
      await api.register(async (authed) => {
        authed.addHook('onRequest', authenticate);
        await authed.register(sessionRoutes, { profiles: container.profiles });
        await authed.register(realtimeRoutes, { hub: container.hub });
        await authed.register(notificationRoutes, { notifications: container.notifications });

        await authed.register(
          async (me) => {
            me.addHook('onRequest', requireRole('author'));
            await me.register(bookRoutes, { books: container.books });
            await me.register(authorTicketRoutes, { tickets: container.tickets });
            await me.register(assistRoutes, { assist: container.assist });
            await me.register(uploadRequestRoutes, { attachments: container.attachments, tag: 'Author' });
          },
          { prefix: '/me' },
        );

        await authed.register(
          async (admin) => {
            admin.addHook('onRequest', requireRole('admin'));
            await admin.register(adminTicketRoutes, {
              tickets: container.tickets,
              profiles: container.profiles,
            });
            await admin.register(aiRoutes, { ai: container.ai });
            await admin.register(knowledgeRoutes, { knowledge: container.knowledge });
            await admin.register(authorRoutes, { authors: container.authors });
            await admin.register(insightsRoutes, { insights: container.insights });
            await admin.register(alertRoutes, { alerts: container.alerts });
            await admin.register(uploadRequestRoutes, {
              attachments: container.attachments,
              tag: 'Admin · Tickets',
            });
          },
          { prefix: '/admin' },
        );
      });
    },
    { prefix: '/api/v1' },
  );

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
