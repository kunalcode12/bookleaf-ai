import {
  AdminDirectoryResponseSchema,
  AdminReplyRequestSchema,
  AdminTicketDetailSchema,
  AdminTicketListQuerySchema,
  AdminTicketListResponseSchema,
  AssignTicketRequestSchema,
  CreateNoteRequestSchema,
  InternalNoteSchema,
  QueueStatsSchema,
  TicketParamsSchema,
  UpdateTicketRequestSchema,
} from '@bookleaf/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../../http/context';
import { etagFor, IdempotencyHeadersSchema, IfMatchHeadersSchema, parseIfMatch } from '../../http/headers';
import type { ProfileService } from '../profiles/service';
import type { TicketService } from './service';

const TAG = 'Admin · Tickets';

/** Mounted at /api/v1/admin behind the admin role guard. */
export const adminTicketRoutes: FastifyPluginAsyncZod<{
  tickets: TicketService;
  profiles: ProfileService;
}> = async (app, { tickets, profiles }) => {
  app.get(
    '/tickets',
    {
      schema: {
        tags: [TAG],
        summary: 'Ticket queue across all authors',
        description:
          'Filter by `status`, `category`, `priority` (comma-separated), `assignee` (me | unassigned | id), `createdFrom`/`createdTo` (dates), `flag`, `sla` (breached | at_risk) or full-text `q` (also matches BL-numbers). Default sort `urgency` puts unresolved, most urgent and oldest tickets first.',
        querystring: AdminTicketListQuerySchema,
        response: { 200: AdminTicketListResponseSchema },
      },
    },
    async (request) => tickets.listForAdmin(actorOf(request), request.query),
  );

  app.get(
    '/tickets/stats',
    {
      schema: {
        tags: [TAG],
        summary: 'Queue counters (critical, breaching, unassigned…)',
        response: { 200: QueueStatsSchema },
      },
    },
    async (request) => tickets.stats(actorOf(request)),
  );

  app.get(
    '/tickets/:ticketRef',
    {
      schema: {
        tags: [TAG],
        summary: 'Ticket workspace: thread, notes, timeline, Leaf triage and draft, author context',
        params: TicketParamsSchema,
        response: { 200: AdminTicketDetailSchema },
      },
    },
    async (request, reply) => {
      const detail = await tickets.getForAdmin(actorOf(request), request.params.ticketRef);
      reply.header('etag', etagFor(detail.version));
      return detail;
    },
  );

  app.patch(
    '/tickets/:ticketRef',
    {
      schema: {
        tags: [TAG],
        summary: 'Change status, or override Leaf’s category / priority',
        description:
          'Send the ETag from GET as `If-Match` to avoid overwriting a colleague’s change (412 if the ticket changed). Status changes follow the ticket state machine (409 with the allowed transitions otherwise).',
        params: TicketParamsSchema,
        headers: IfMatchHeadersSchema,
        body: UpdateTicketRequestSchema,
        response: { 200: AdminTicketDetailSchema },
      },
    },
    async (request, reply) => {
      const detail = await tickets.update(
        actorOf(request),
        request.params.ticketRef,
        request.body,
        parseIfMatch(request.headers['if-match']),
      );
      reply.header('etag', etagFor(detail.version));
      return detail;
    },
  );

  app.put(
    '/tickets/:ticketRef/assignee',
    {
      schema: {
        tags: [TAG],
        summary: 'Assign the ticket (to "me", a colleague, or null to unassign)',
        params: TicketParamsSchema,
        body: AssignTicketRequestSchema,
        response: { 200: AdminTicketDetailSchema },
      },
    },
    async (request) => tickets.assign(actorOf(request), request.params.ticketRef, request.body),
  );

  app.post(
    '/tickets/:ticketRef/messages',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: (r) => actorOf(r).profileId,
        },
      },
      schema: {
        tags: [TAG],
        summary: 'Send a reply to the author (optionally from a Leaf draft, optionally resolving)',
        params: TicketParamsSchema,
        headers: IdempotencyHeadersSchema,
        body: AdminReplyRequestSchema,
        response: { 201: AdminTicketDetailSchema },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await tickets.replyAsAdmin(
            actorOf(request),
            request.params.ticketRef,
            request.body,
            request.headers['idempotency-key'] ?? null,
          ),
        ),
  );

  app.get(
    '/tickets/:ticketRef/notes',
    {
      schema: {
        tags: [TAG],
        summary: 'Internal notes (never visible to the author)',
        params: TicketParamsSchema,
        response: { 200: z.object({ data: z.array(InternalNoteSchema) }) },
      },
    },
    async (request) => ({ data: await tickets.listNotes(actorOf(request), request.params.ticketRef) }),
  );

  app.post(
    '/tickets/:ticketRef/notes',
    {
      schema: {
        tags: [TAG],
        summary: 'Add an internal note',
        params: TicketParamsSchema,
        body: CreateNoteRequestSchema,
        response: { 201: InternalNoteSchema },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await tickets.addNote(actorOf(request), request.params.ticketRef, request.body.body)),
  );

  app.get(
    '/team',
    {
      schema: {
        tags: [TAG],
        summary: 'BookLeaf team members (for assignment)',
        response: { 200: AdminDirectoryResponseSchema },
      },
    },
    async () => ({ data: await profiles.listAdmins() }),
  );
};
