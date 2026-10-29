import {
  AuthorTicketDetailSchema,
  AuthorTicketListQuerySchema,
  AuthorTicketListResponseSchema,
  CreateAuthorMessageRequestSchema,
  CreateTicketRequestSchema,
  TicketFeedbackRequestSchema,
  TicketParamsSchema,
} from '@bookleaf/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { actorOf } from '../../http/context';
import { IdempotencyHeadersSchema } from '../../http/headers';
import type { TicketService } from './service';

const TAG = 'Author';
const perProfile = (max: number, timeWindow: string) => ({
  rateLimit: {
    max,
    timeWindow,
    hook: 'preHandler' as const,
    keyGenerator: (request: Parameters<typeof actorOf>[0]) => actorOf(request).profileId,
  },
});

/** Mounted at /api/v1/me — every query is scoped to the signed-in author (and enforced by RLS). */
export const authorTicketRoutes: FastifyPluginAsyncZod<{ tickets: TicketService }> = async (
  app,
  { tickets },
) => {
  app.get(
    '/tickets',
    {
      schema: {
        tags: [TAG],
        summary: 'My tickets',
        querystring: AuthorTicketListQuerySchema,
        response: { 200: AuthorTicketListResponseSchema },
      },
    },
    async (request) => tickets.listForAuthor(actorOf(request), request.query),
  );

  app.post(
    '/tickets',
    {
      config: perProfile(10, '1 hour'),
      schema: {
        tags: [TAG],
        summary: 'Submit a support query',
        description:
          'Creates the ticket immediately; Leaf triages it in the background (the response never waits on AI). Send an `Idempotency-Key` so a retried request cannot create a duplicate.',
        headers: IdempotencyHeadersSchema,
        body: CreateTicketRequestSchema,
        response: { 200: AuthorTicketDetailSchema, 201: AuthorTicketDetailSchema },
      },
    },
    async (request, reply) => {
      const { ticket, replayed } = await tickets.create(
        actorOf(request),
        request.body,
        request.headers['idempotency-key'] ?? null,
      );
      if (replayed) reply.header('idempotent-replayed', 'true');
      reply.header('location', `/api/v1/me/tickets/${ticket.id}`);
      return reply.status(replayed ? 200 : 201).send(ticket);
    },
  );

  app.get(
    '/tickets/:ticketRef',
    {
      schema: {
        tags: [TAG],
        summary: 'One of my tickets, with the conversation',
        params: TicketParamsSchema,
        response: { 200: AuthorTicketDetailSchema },
      },
    },
    async (request) => tickets.getForAuthor(actorOf(request), request.params.ticketRef),
  );

  app.post(
    '/tickets/:ticketRef/messages',
    {
      config: perProfile(30, '1 hour'),
      schema: {
        tags: [TAG],
        summary: 'Reply on my ticket (reopens it if it was resolved)',
        params: TicketParamsSchema,
        headers: IdempotencyHeadersSchema,
        body: CreateAuthorMessageRequestSchema,
        response: { 201: AuthorTicketDetailSchema },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await tickets.replyAsAuthor(
            actorOf(request),
            request.params.ticketRef,
            request.body,
            request.headers['idempotency-key'] ?? null,
          ),
        ),
  );

  app.post(
    '/tickets/:ticketRef/feedback',
    {
      schema: {
        tags: [TAG],
        summary: 'Rate the response on a resolved ticket',
        params: TicketParamsSchema,
        body: TicketFeedbackRequestSchema,
        response: { 200: AuthorTicketDetailSchema },
      },
    },
    async (request) => tickets.giveFeedback(actorOf(request), request.params.ticketRef, request.body),
  );
};
