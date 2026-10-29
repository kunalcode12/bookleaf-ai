import type { Leaf } from '@bookleaf/ai';
import type { DatabaseHandle } from '@bookleaf/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { RealtimeHub } from '../realtime/hub';

const ReadySchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  checks: z.object({
    database: z.enum(['ok', 'down']),
    realtime: z.enum(['ok', 'polling']),
    ai: z.enum(['operational', 'degraded', 'offline']),
    worker: z.enum(['inline', 'separate']),
  }),
  version: z.string(),
});

/** Liveness (process up) and readiness (dependencies reachable) for the platform's health checks. */
export const healthRoutes: FastifyPluginAsyncZod<{
  handle: DatabaseHandle;
  hub: RealtimeHub;
  leaf: Leaf;
  workerInline: boolean;
}> = async (app, deps) => {
  const startedAt = Date.now();

  app.get(
    '/health/live',
    {
      schema: {
        tags: ['System'],
        security: [],
        response: { 200: z.object({ status: z.literal('ok'), uptimeSeconds: z.number() }) },
      },
    },
    async () => ({ status: 'ok' as const, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) }),
  );

  app.get(
    '/health/ready',
    { schema: { tags: ['System'], security: [], response: { 200: ReadySchema, 503: ReadySchema } } },
    async (_request, reply) => {
      const database = (await deps.handle.ping()) ? 'ok' : 'down';
      const ai = deps.leaf.health().status;
      const body = {
        status:
          database === 'down'
            ? ('down' as const)
            : ai === 'operational'
              ? ('ok' as const)
              : ('degraded' as const),
        checks: {
          database: database as 'ok' | 'down',
          realtime: deps.hub.listening ? ('ok' as const) : ('polling' as const),
          ai,
          worker: deps.workerInline ? ('inline' as const) : ('separate' as const),
        },
        version: process.env.APP_VERSION ?? '1.0.0',
      };
      return reply.status(database === 'down' ? 503 : 200).send(body);
    },
  );
};
