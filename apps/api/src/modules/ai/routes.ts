import {
  AiDraftSchema,
  AiHealthSchema,
  OkResponseSchema,
  RegenerateDraftRequestSchema,
  TicketParamsSchema,
} from '@bookleaf/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../../http/context';
import { AppError } from '../../lib/errors';
import type { TicketAiService } from './service';

const TAG = 'Admin · Leaf';

export const aiRoutes: FastifyPluginAsyncZod<{ ai: TicketAiService }> = async (app, { ai }) => {
  app.get(
    '/tickets/:ticketRef/draft',
    {
      schema: {
        tags: [TAG],
        summary: "Leaf's latest draft reply for a ticket",
        params: TicketParamsSchema,
        response: { 200: z.object({ draft: AiDraftSchema.nullable() }) },
      },
    },
    async (request) => ({ draft: await ai.latestDraft(actorOf(request), request.params.ticketRef) }),
  );

  app.post(
    '/tickets/:ticketRef/draft',
    {
      config: {
        rateLimit: {
          max: 12,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: (r) => actorOf(r).profileId,
        },
      },
      schema: {
        tags: [TAG],
        summary: 'Regenerate or refine the draft (streams with Accept: text/event-stream)',
        description:
          'Send a `preset` (shorter, warmer, …) or a free-text `instruction` to refine the latest draft, or neither for a fresh one. With `Accept: text/event-stream` the reply streams as `start` → `delta`* → `done` events (`reset` if a model fails mid-answer and another takes over; `error` on failure).',
        params: TicketParamsSchema,
        body: RegenerateDraftRequestSchema,
        response: { 201: AiDraftSchema },
      },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      const wantsStream = request.headers.accept?.includes('text/event-stream');
      if (!wantsStream) {
        return reply.status(201).send(await ai.regenerate(actor, request.params.ticketRef, request.body));
      }

      const controller = new AbortController();
      const headers = {
        ...(reply.getHeaders() as Record<string, string>),
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
        'x-request-id': String(request.id),
      };
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, headers);
      let open = true;
      request.raw.on('close', () => {
        open = false;
        controller.abort();
      });
      const send = (event: string, data: unknown) => {
        if (open && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      try {
        const draft = await ai.regenerate(actor, request.params.ticketRef, request.body, {
          signal: controller.signal,
          onStart: (d) => send('start', { draftId: d.id, version: d.version }),
          onDelta: (text) => send('delta', { text }),
          onReset: () => send('reset', {}),
        });
        send('done', { draft });
      } catch (error) {
        const appError = error instanceof AppError ? error : null;
        if (!appError) request.log.error({ err: error }, 'draft stream failed');
        send('error', {
          code: appError?.code ?? 'INTERNAL',
          message: appError?.message ?? 'Leaf could not finish this draft. You can write the reply manually.',
          draft: null,
        });
      } finally {
        if (!res.writableEnded) res.end();
      }
    },
  );

  app.post(
    '/tickets/:ticketRef/triage',
    {
      schema: {
        tags: [TAG],
        summary: 'Re-run Leaf triage (e.g. after the AI was unavailable)',
        params: TicketParamsSchema,
        response: { 202: OkResponseSchema },
      },
    },
    async (request, reply) => {
      await ai.requestTriage(actorOf(request), request.params.ticketRef);
      return reply.status(202).send({ ok: true as const });
    },
  );

  app.get(
    '/ai/health',
    {
      schema: {
        tags: [TAG],
        summary: 'Leaf provider status (circuit breakers, routes, degraded mode)',
        response: { 200: AiHealthSchema },
      },
    },
    async () => ai.health(),
  );
};
