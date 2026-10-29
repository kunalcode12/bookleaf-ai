import {
  type AdminReplyRequestSchema,
  type AdminTicketDetail,
  type AdminTicketListQuery,
  type AdminTicketListResponse,
  type AssignTicketRequestSchema,
  type AuthorTicketDetail,
  type AuthorTicketListQuery,
  type AuthorTicketListResponse,
  type CreateAuthorMessageRequestSchema,
  type CreateTicketRequestSchema,
  formatTicketNumber,
  type InternalNote,
  type QueueStats,
  type TicketCategory,
  type TicketFeedbackRequest,
  type TicketMessage,
  type TicketPriority,
  type TicketStatus,
  type UpdateTicketRequest,
} from '@bookleaf/contracts';
import { type Database, schema, type Transaction, withActor } from '@bookleaf/db';
import {
  allowedTransitions,
  assertTransition,
  slaDueAt,
  statusAfterAdminReply,
  statusAfterAuthorReply,
} from '@bookleaf/domain';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { z } from 'zod';
import type { RequestActor } from '../../http/context';
import { authorIdOf } from '../../http/context';
import type { JobQueue } from '../../jobs/queue';
import type { Clock } from '../../lib/clock';
import { decodeCursor, encodeCursor, fingerprintOf } from '../../lib/cursor';
import { Errors } from '../../lib/errors';
import { editRatio } from '../../lib/text-diff';
import type { AttachmentRow, AttachmentService } from '../attachments/service';
import { selectBookRecords, toBookDto } from '../books/records';
import type { NotificationService } from '../notifications/service';
import { toAdminListItem, toAuthorSummary, toDraft, toEvent, toMessage, toNote, triageView } from './mapper';
import {
  type EventInput,
  findTicket,
  insertEvents,
  listAdminTickets,
  listAuthorTickets,
  loadDrafts,
  loadEvents,
  loadMessages,
  loadNotes,
  queueStats,
  similarTickets,
  type TicketRow,
} from './queries';

type CreateTicketInput = z.output<typeof CreateTicketRequestSchema>;
type AuthorMessageInput = z.output<typeof CreateAuthorMessageRequestSchema>;
type AdminReplyInput = z.output<typeof AdminReplyRequestSchema>;
type AssignInput = z.output<typeof AssignTicketRequestSchema>;

const { tickets, ticketMessages, ticketNotes, books, profiles, aiDrafts, authors } = schema;

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';

/**
 * Ticket lifecycle for both audiences. Every operation runs in one actor-scoped transaction
 * (row-level security applies), writes its audit events in that same transaction (realtime
 * fan-out happens on commit), and enqueues AI work transactionally.
 */
export class TicketService {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly queue: JobQueue,
    private readonly attachments: AttachmentService,
    private readonly notifications: NotificationService,
    private readonly logger: Logger,
  ) {}

  // ─── Shared helpers ────────────────────────────────────────────────────────

  private async messagesWithAttachments(tx: Transaction, ticketId: string) {
    const [messages, attachmentRows] = await Promise.all([
      loadMessages(tx, ticketId),
      this.attachments.forTicket(tx, ticketId),
    ]);
    return { messages, attachmentRows };
  }

  private async toMessageDtos(
    messages: Awaited<ReturnType<typeof loadMessages>>,
    attachmentRows: AttachmentRow[],
  ): Promise<{
    thread: TicketMessage[];
    ticketAttachments: Awaited<ReturnType<AttachmentService['toDtos']>>;
  }> {
    const dtos = await this.attachments.toDtos(attachmentRows);
    const byId = new Map(attachmentRows.map((row, i) => [row.id, { row, dto: dtos[i]! }]));
    const forMessage = (messageId: string | null) =>
      [...byId.values()].filter((a) => a.row.messageId === messageId).map((a) => a.dto);
    return {
      thread: messages.map((m) => toMessage(m, forMessage(m.id))),
      ticketAttachments: forMessage(null),
    };
  }

  // ─── Author ────────────────────────────────────────────────────────────────

  async listForAuthor(actor: RequestActor, query: AuthorTicketListQuery): Promise<AuthorTicketListResponse> {
    const authorId = authorIdOf(actor);
    const fingerprint = fingerprintOf({ status: query.status ?? null, limit: query.limit });
    const offset = decodeCursor(query.cursor, fingerprint);
    const { rows, hasMore } = await withActor(
      this.db,
      actor.db,
      (tx) => listAuthorTickets(tx, authorId, query, offset),
      { readOnly: true },
    );
    return {
      data: rows.map(toAuthorSummary),
      pageInfo: { nextCursor: hasMore ? encodeCursor(offset + query.limit, fingerprint) : null, hasMore },
    };
  }

  async getForAuthor(actor: RequestActor, ref: string): Promise<AuthorTicketDetail> {
    const now = this.clock.now();
    const detail = await withActor(this.db, actor.db, async (tx) => {
      const row = await findTicket(tx, ref);
      if (!row) throw Errors.notFound('Ticket');
      const [{ messages, attachmentRows }, events] = await Promise.all([
        this.messagesWithAttachments(tx, row.id),
        loadEvents(tx, row.id, true),
      ]);
      // Read receipt (doesn't count as a ticket change — see the tickets touch trigger).
      await tx.update(tickets).set({ authorLastReadAt: now }).where(eq(tickets.id, row.id));
      return { row, messages, attachmentRows, events };
    });

    const { thread, ticketAttachments } = await this.toMessageDtos(detail.messages, detail.attachmentRows);
    await this.notifications.markTicketRead(actor, detail.row.id).catch(() => undefined);
    const { row } = detail;
    const summary = toAuthorSummary({ ...row, authorLastReadAt: now });

    return {
      ...summary,
      description: row.description,
      attachments: ticketAttachments,
      messages: thread,
      timeline: detail.events.flatMap((e): AuthorTicketDetail['timeline'] => {
        if (e.type === 'ticket.created')
          return [{ type: 'created' as const, status: 'open' as const, at: e.createdAt.toISOString() }];
        if (e.type === 'ticket.reopened')
          return [{ type: 'reopened' as const, status: 'open' as const, at: e.createdAt.toISOString() }];
        if (e.type === 'ticket.status_changed') {
          const to = (e.payload as { to?: TicketStatus }).to ?? null;
          return [{ type: 'status_changed' as const, status: to, at: e.createdAt.toISOString() }];
        }
        return [];
      }),
      canReply: row.status !== 'closed',
      canGiveFeedback: (row.status === 'resolved' || row.status === 'closed') && row.feedbackRating === null,
      feedback:
        row.feedbackRating !== null && row.feedbackAt
          ? {
              rating: row.feedbackRating > 0 ? 'up' : 'down',
              comment: row.feedbackComment,
              at: row.feedbackAt.toISOString(),
            }
          : null,
    };
  }

  async create(
    actor: RequestActor,
    input: CreateTicketInput,
    idempotencyKey: string | null,
  ): Promise<{ ticket: AuthorTicketDetail; replayed: boolean }> {
    const authorId = authorIdOf(actor);
    const now = this.clock.now();

    const findExisting = async (tx: Transaction) => {
      if (!idempotencyKey) return null;
      const [existing] = await tx
        .select({ id: tickets.id })
        .from(tickets)
        .where(and(eq(tickets.authorId, authorId), eq(tickets.clientRequestId, idempotencyKey)));
      return existing?.id ?? null;
    };

    let result: { id: string; replayed: boolean };
    try {
      result = await withActor(this.db, actor.db, async (tx) => {
        const existing = await findExisting(tx);
        if (existing) return { id: existing, replayed: true };

        if (input.bookId) {
          const [book] = await tx
            .select({ id: books.id })
            .from(books)
            .where(and(eq(books.id, input.bookId), eq(books.authorId, authorId)));
          if (!book) throw Errors.validation([{ path: 'bookId', message: 'Choose one of your own books.' }]);
        }

        const [ticket] = await tx
          .insert(tickets)
          .values({
            authorId,
            bookId: input.bookId,
            createdById: actor.profileId,
            subject: input.subject,
            description: input.description,
            clientRequestId: idempotencyKey,
            lastAuthorMessageAt: now,
            authorLastReadAt: now,
          })
          .returning({ id: tickets.id });
        await this.attachments.claim(tx, actor, input.attachmentIds, {
          ticketId: ticket!.id,
          messageId: null,
        });
        await insertEvents(tx, [
          {
            ticketId: ticket!.id,
            actorType: 'author',
            actorId: actor.profileId,
            type: 'ticket.created',
            visibility: 'public',
            payload: { bookId: input.bookId },
          },
        ]);
        // Enqueued in the same transaction: no ticket without a triage job, no job without a ticket.
        await this.queue.send('ticket.triage', { ticketId: ticket!.id, reason: 'created' }, { tx });
        return { id: ticket!.id, replayed: false };
      });
    } catch (error) {
      // Two concurrent submissions with the same key: the loser returns the winner's ticket.
      if (idempotencyKey && isUniqueViolation(error)) {
        const id = await withActor(this.db, actor.db, findExisting, { readOnly: true });
        if (id) result = { id, replayed: true };
        else throw error;
      } else {
        throw error;
      }
    }

    return { ticket: await this.getForAuthor(actor, result.id), replayed: result.replayed };
  }

  async replyAsAuthor(
    actor: RequestActor,
    ref: string,
    input: AuthorMessageInput,
    idempotencyKey: string | null,
  ): Promise<AuthorTicketDetail> {
    const now = this.clock.now();
    const ticketId = await withActor(this.db, actor.db, async (tx) => {
      const row = await findTicket(tx, ref, { forUpdate: true });
      if (!row) throw Errors.notFound('Ticket');
      if (idempotencyKey) {
        const [dup] = await tx
          .select({ id: ticketMessages.id })
          .from(ticketMessages)
          .where(
            and(eq(ticketMessages.ticketId, row.id), eq(ticketMessages.clientRequestId, idempotencyKey)),
          );
        if (dup) return row.id;
      }
      const { next, reopened } = statusAfterAuthorReply(row.status);

      const [message] = await tx
        .insert(ticketMessages)
        .values({
          ticketId: row.id,
          senderType: 'author',
          senderId: actor.profileId,
          senderName: actor.displayName,
          body: input.body,
          clientRequestId: idempotencyKey,
        })
        .returning({ id: ticketMessages.id });
      await this.attachments.claim(tx, actor, input.attachmentIds, {
        ticketId: row.id,
        messageId: message!.id,
      });

      await tx
        .update(tickets)
        .set({
          status: next,
          messageCount: sql`${tickets.messageCount} + 1`,
          threadVersion: sql`${tickets.threadVersion} + 1`,
          lastAuthorMessageAt: now,
          authorLastReadAt: now,
          draftStatus: 'pending',
          ...(reopened ? { resolvedAt: null, version: sql`${tickets.version} + 1` } : {}),
        })
        .where(eq(tickets.id, row.id));

      const events: EventInput[] = [
        {
          ticketId: row.id,
          actorType: 'author',
          actorId: actor.profileId,
          type: 'ticket.message_created',
          visibility: 'public',
          payload: { messageId: message!.id, sender: 'author' },
        },
      ];
      if (reopened) {
        events.push({
          ticketId: row.id,
          actorType: 'author',
          actorId: actor.profileId,
          type: 'ticket.reopened',
          visibility: 'public',
          payload: { from: row.status, to: next },
        });
      }
      await insertEvents(tx, events);
      // A follow-up may raise urgency ("it's been three weeks…"); re-triage can only escalate.
      await this.queue.send(
        'ticket.triage',
        { ticketId: row.id, reason: 'followup' },
        { tx, singletonKey: `followup:${row.id}` },
      );
      return row.id;
    });
    return this.getForAuthor(actor, ticketId);
  }

  async giveFeedback(
    actor: RequestActor,
    ref: string,
    input: TicketFeedbackRequest,
  ): Promise<AuthorTicketDetail> {
    const now = this.clock.now();
    const ticketId = await withActor(this.db, actor.db, async (tx) => {
      const row = await findTicket(tx, ref, { forUpdate: true });
      if (!row) throw Errors.notFound('Ticket');
      if (row.status !== 'resolved' && row.status !== 'closed') {
        throw Errors.conflict('CONFLICT', 'You can rate the response once the ticket is resolved.');
      }
      await tx
        .update(tickets)
        .set({
          feedbackRating: input.rating === 'up' ? 1 : -1,
          feedbackComment: input.comment?.trim() || null,
          feedbackAt: now,
        })
        .where(eq(tickets.id, row.id));
      await insertEvents(tx, [
        {
          ticketId: row.id,
          actorType: 'author',
          actorId: actor.profileId,
          type: 'ticket.feedback',
          visibility: 'internal',
          payload: { rating: input.rating },
        },
      ]);
      return row.id;
    });
    return this.getForAuthor(actor, ticketId);
  }

  // ─── Admin ─────────────────────────────────────────────────────────────────

  async listForAdmin(actor: RequestActor, query: AdminTicketListQuery): Promise<AdminTicketListResponse> {
    const now = this.clock.now();
    const { cursor: _cursor, ...rest } = query;
    const fingerprint = fingerprintOf(rest);
    const offset = decodeCursor(query.cursor, fingerprint);
    const { rows, hasMore } = await withActor(
      this.db,
      actor.db,
      (tx) => listAdminTickets(tx, query, { profileId: actor.profileId, now, offset }),
      { readOnly: true },
    );
    return {
      data: rows.map((r) => toAdminListItem(r, now)),
      pageInfo: { nextCursor: hasMore ? encodeCursor(offset + query.limit, fingerprint) : null, hasMore },
    };
  }

  async stats(actor: RequestActor): Promise<QueueStats> {
    const now = this.clock.now();
    return withActor(this.db, actor.db, (tx) => queueStats(tx, actor.profileId, now), { readOnly: true });
  }

  async getForAdmin(actor: RequestActor, ref: string): Promise<AdminTicketDetail> {
    const now = this.clock.now();
    const data = await withActor(
      this.db,
      actor.db,
      async (tx) => {
        const row = await findTicket(tx, ref);
        if (!row) throw Errors.notFound('Ticket');
        const [thread, notes, events, drafts, bookRecords, recent, author, similar] = await Promise.all([
          this.messagesWithAttachments(tx, row.id),
          loadNotes(tx, row.id),
          loadEvents(tx, row.id, false),
          loadDrafts(tx, row.id),
          selectBookRecords(tx, eq(books.authorId, row.authorId)),
          tx
            .select({
              id: tickets.id,
              number: tickets.number,
              subject: tickets.subject,
              status: tickets.status,
              createdAt: tickets.createdAt,
            })
            .from(tickets)
            .where(and(eq(tickets.authorId, row.authorId), sql`${tickets.id} <> ${row.id}`))
            .orderBy(desc(tickets.createdAt))
            .limit(5),
          tx
            .select({ phone: authors.phone, city: authors.city, joinedDate: authors.joinedDate })
            .from(authors)
            .where(eq(authors.id, row.authorId)),
          row.hasEmbedding ? similarTickets(tx, row.id) : Promise.resolve([]),
        ]);
        return { row, thread, notes, events, drafts, bookRecords, recent, author: author[0]!, similar };
      },
      { readOnly: true },
    );

    const { row } = data;
    const { thread, ticketAttachments } = await this.toMessageDtos(
      data.thread.messages,
      data.thread.attachmentRows,
    );
    this.ensureFreshDraft(row, data.drafts).catch((error) =>
      this.logger.warn({ err: error, ticketId: row.id }, 'could not schedule draft refresh'),
    );

    const money = (amountMinor: number) => ({ amountMinor, currency: 'INR' as const });
    const totals = data.bookRecords.reduce(
      (acc, b) => ({
        earned: acc.earned + b.earnedMinor,
        paid: acc.paid + b.paidMinor,
        pending: acc.pending + b.pendingMinor,
        copies: acc.copies + b.copiesSold,
      }),
      { earned: 0, paid: 0, pending: 0, copies: 0 },
    );

    return {
      ...toAdminListItem(row, now),
      description: row.description,
      attachments: ticketAttachments,
      messages: thread,
      notes: data.notes.map(toNote),
      events: data.events.map(toEvent),
      triage: triageView(row),
      draft: toDraft(data.drafts, row.threadVersion),
      authorContext: {
        id: row.authorId,
        externalId: row.authorExternalId,
        name: row.authorName,
        email: row.authorEmail,
        phone: data.author.phone,
        city: data.author.city,
        joinedDate: data.author.joinedDate,
        totals: {
          royaltyEarned: money(totals.earned),
          royaltyPaid: money(totals.paid),
          royaltyPending: money(totals.pending),
          copiesSold: totals.copies,
        },
        books: data.bookRecords.map((b) => toBookDto(b, now)),
        recentTickets: data.recent.map((t) => ({
          id: t.id,
          number: formatTicketNumber(t.number),
          subject: t.subject,
          status: t.status,
          createdAt: t.createdAt.toISOString(),
        })),
      },
      similarTickets: data.similar.map((s) => ({
        id: s.id,
        number: formatTicketNumber(Number(s.number)),
        subject: s.subject,
        status: s.status,
        category: (s.category as TicketCategory | null) ?? null,
        authorName: s.author_name,
        similarity: Math.round(Number(s.similarity) * 100) / 100,
        createdAt: new Date(s.created_at).toISOString(),
      })),
      allowedTransitions: [...allowedTransitions(row.status)],
      feedback:
        row.feedbackRating !== null && row.feedbackAt
          ? {
              rating: row.feedbackRating > 0 ? 'up' : 'down',
              comment: row.feedbackComment,
              at: row.feedbackAt.toISOString(),
            }
          : null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      closedAt: row.closedAt?.toISOString() ?? null,
      version: row.version,
    };
  }

  /**
   * Drafts are regenerated lazily: when an admin opens a ticket whose conversation changed since
   * the last draft. Follow-ups that arrive before anyone looks cost no tokens.
   */
  private async ensureFreshDraft(row: TicketRow, drafts: Awaited<ReturnType<typeof loadDrafts>>) {
    if (row.status !== 'open' && row.status !== 'in_progress') return;
    const latest = drafts[0]?.draft;
    const generatingRecently =
      latest?.status === 'generating' && this.clock.now().getTime() - latest.createdAt.getTime() < 3 * 60_000;
    if (generatingRecently || row.draftStatus === 'processing') return;
    const stale = !latest || latest.threadVersion < row.threadVersion;
    if (!stale || row.triageStatus === 'pending' || row.triageStatus === 'processing') return;
    await this.queue.send(
      'ticket.draft',
      { ticketId: row.id, reason: 'stale' },
      { singletonKey: `draft:${row.id}` },
    );
  }

  async update(
    actor: RequestActor,
    ref: string,
    patch: UpdateTicketRequest,
    expectedVersion: number | null,
  ): Promise<AdminTicketDetail> {
    const now = this.clock.now();
    const outcome = await withActor(this.db, actor.db, async (tx) => {
      const row = await findTicket(tx, ref, { forUpdate: true });
      if (!row) throw Errors.notFound('Ticket');
      if (expectedVersion !== null && expectedVersion !== row.version) {
        throw Errors.preconditionFailed({ currentVersion: row.version });
      }

      const changes: Partial<typeof tickets.$inferInsert> = {};
      const events: EventInput[] = [];
      const base = { ticketId: row.id, actorType: 'admin' as const, actorId: actor.profileId };

      if (patch.status && patch.status !== row.status) {
        assertTransition(row.status, patch.status);
        changes.status = patch.status;
        if (patch.status === 'resolved') changes.resolvedAt = now;
        if (patch.status === 'closed') changes.closedAt = now;
        if (row.status === 'resolved' && (patch.status === 'open' || patch.status === 'in_progress')) {
          changes.resolvedAt = null;
        }
        events.push({
          ...base,
          type: 'ticket.status_changed',
          visibility: 'public',
          payload: { from: row.status, to: patch.status },
        });
      }
      if (patch.category && (patch.category !== row.category || row.categorySource !== 'admin')) {
        changes.category = patch.category;
        changes.categorySource = 'admin';
        // A different category means different policies: the current draft is now stale.
        changes.threadVersion = row.threadVersion + 1;
        events.push({
          ...base,
          type: 'ticket.category_changed',
          visibility: 'internal',
          payload: {
            from: row.category,
            to: patch.category,
            previousSource: row.categorySource,
            aiProposed: row.aiCategory,
          },
        });
      }
      if (patch.priority && (patch.priority !== row.priority || row.prioritySource !== 'admin')) {
        changes.priority = patch.priority;
        changes.prioritySource = 'admin';
        if (!row.firstResponseAt)
          changes.slaDueAt = slaDueAt(row.createdAt, patch.priority as TicketPriority);
        events.push({
          ...base,
          type: 'ticket.priority_changed',
          visibility: 'internal',
          payload: {
            from: row.priority,
            to: patch.priority,
            previousSource: row.prioritySource,
            aiProposed: row.aiPriority,
          },
        });
      }
      if (events.length === 0) return { row, resolved: false };

      const updated = await tx
        .update(tickets)
        .set({ ...changes, version: row.version + 1 })
        .where(and(eq(tickets.id, row.id), eq(tickets.version, row.version)))
        .returning({ id: tickets.id });
      if (updated.length === 0) throw Errors.preconditionFailed();
      await insertEvents(tx, events);
      return { row, resolved: changes.status === 'resolved' };
    });

    if (outcome.resolved) {
      const author = await this.authorContactFor(outcome.row.authorId);
      if (author) {
        await this.notifications.notify([
          {
            recipientId: author.profileId,
            type: 'ticket_status',
            title: `${formatTicketNumber(outcome.row.number)} has been resolved`,
            body: `Your query "${outcome.row.subject}" was marked resolved. Reply if anything is still open.`,
            ticketId: outcome.row.id,
          },
        ]);
      }
    }
    return this.getForAdmin(actor, outcome.row.id);
  }

  async assign(actor: RequestActor, ref: string, input: AssignInput): Promise<AdminTicketDetail> {
    const target = input.assigneeId === 'me' ? actor.profileId : input.assigneeId;
    const outcome = await withActor(this.db, actor.db, async (tx) => {
      const row = await findTicket(tx, ref, { forUpdate: true });
      if (!row) throw Errors.notFound('Ticket');
      if (row.assigneeId === target) return { row, assigneeName: row.assigneeName, changed: false };

      let assigneeName: string | null = null;
      if (target) {
        const [person] = await tx
          .select({ id: profiles.id, name: profiles.displayName, role: profiles.role })
          .from(profiles)
          .where(eq(profiles.id, target));
        if (person?.role !== 'admin') {
          throw Errors.validation([
            { path: 'assigneeId', message: 'Tickets can only be assigned to BookLeaf team members.' },
          ]);
        }
        assigneeName = person.name;
      }
      if (row.assigneeId && target && row.assigneeId !== actor.profileId && !input.force) {
        throw Errors.conflict(
          'ASSIGNMENT_CONFLICT',
          `${row.assigneeName ?? 'A colleague'} is already handling this ticket.`,
          {
            assignee: { id: row.assigneeId, displayName: row.assigneeName },
          },
        );
      }
      await tx
        .update(tickets)
        .set({ assigneeId: target, version: row.version + 1 })
        .where(eq(tickets.id, row.id));
      await insertEvents(tx, [
        {
          ticketId: row.id,
          actorType: 'admin',
          actorId: actor.profileId,
          type: target ? 'ticket.assigned' : 'ticket.unassigned',
          visibility: 'internal',
          payload: { from: row.assigneeId, fromName: row.assigneeName, to: target, toName: assigneeName },
        },
      ]);
      return { row, assigneeName, changed: true };
    });

    if (outcome.changed && target && target !== actor.profileId) {
      await this.notifications.notify([
        {
          recipientId: target,
          type: 'ticket_assigned',
          title: `${formatTicketNumber(outcome.row.number)} was assigned to you`,
          body: `${actor.displayName} assigned you "${outcome.row.subject}".`,
          ticketId: outcome.row.id,
        },
      ]);
    }
    return this.getForAdmin(actor, outcome.row.id);
  }

  async replyAsAdmin(
    actor: RequestActor,
    ref: string,
    input: AdminReplyInput,
    idempotencyKey: string | null,
  ): Promise<AdminTicketDetail> {
    const now = this.clock.now();
    const outcome = await withActor(this.db, actor.db, async (tx) => {
      const row = await findTicket(tx, ref, { forUpdate: true });
      if (!row) throw Errors.notFound('Ticket');
      if (idempotencyKey) {
        const [dup] = await tx
          .select({ id: ticketMessages.id })
          .from(ticketMessages)
          .where(
            and(eq(ticketMessages.ticketId, row.id), eq(ticketMessages.clientRequestId, idempotencyKey)),
          );
        if (dup) return { row, next: row.status, duplicate: true };
      }
      const next = statusAfterAdminReply(row.status, input.resolve);

      let ratio: number | null = null;
      if (input.draftId) {
        const [draft] = await tx
          .select({ body: aiDrafts.body })
          .from(aiDrafts)
          .where(and(eq(aiDrafts.id, input.draftId), eq(aiDrafts.ticketId, row.id)));
        if (!draft)
          throw Errors.validation([
            { path: 'draftId', message: 'That draft does not belong to this ticket.' },
          ]);
        ratio = draft.body ? editRatio(draft.body, input.body) : null;
        await tx.update(aiDrafts).set({ status: 'sent' }).where(eq(aiDrafts.id, input.draftId));
      }

      const [message] = await tx
        .insert(ticketMessages)
        .values({
          ticketId: row.id,
          senderType: 'admin',
          senderId: actor.profileId,
          senderName: actor.displayName,
          senderTitle: actor.title,
          body: input.body,
          draftId: input.draftId ?? null,
          draftEditRatio: ratio,
          clientRequestId: idempotencyKey,
        })
        .returning({ id: ticketMessages.id });
      await this.attachments.claim(tx, actor, input.attachmentIds, {
        ticketId: row.id,
        messageId: message!.id,
      });

      const autoAssign = row.assigneeId === null;
      await tx
        .update(tickets)
        .set({
          status: next,
          firstResponseAt: row.firstResponseAt ?? now,
          lastAdminMessageAt: now,
          messageCount: sql`${tickets.messageCount} + 1`,
          threadVersion: sql`${tickets.threadVersion} + 1`,
          draftStatus: 'skipped',
          version: row.version + 1,
          ...(autoAssign ? { assigneeId: actor.profileId } : {}),
          ...(next === 'resolved' ? { resolvedAt: now } : {}),
        })
        .where(eq(tickets.id, row.id));

      const base = { ticketId: row.id, actorType: 'admin' as const, actorId: actor.profileId };
      const events: EventInput[] = [
        {
          ...base,
          type: 'ticket.message_created',
          visibility: 'public',
          payload: {
            messageId: message!.id,
            sender: 'admin',
            fromDraft: Boolean(input.draftId),
            editRatio: ratio,
          },
        },
      ];
      if (next !== row.status) {
        events.push({
          ...base,
          type: 'ticket.status_changed',
          visibility: 'public',
          payload: { from: row.status, to: next },
        });
      }
      if (autoAssign) {
        events.push({
          ...base,
          type: 'ticket.assigned',
          visibility: 'internal',
          payload: { from: null, to: actor.profileId, toName: actor.displayName, auto: true },
        });
      }
      await insertEvents(tx, events);
      return { row, next, duplicate: false };
    });

    if (!outcome.duplicate) {
      const author = await this.authorContactFor(outcome.row.authorId);
      if (author) {
        await this.notifications.authorReplied({
          authorProfileId: author.profileId,
          authorEmail: author.email,
          authorName: outcome.row.authorName,
          ticketId: outcome.row.id,
          ticketNumber: outcome.row.number,
          subject: outcome.row.subject,
          resolved: outcome.next === 'resolved',
          agentName: actor.displayName,
        });
      }
    }
    return this.getForAdmin(actor, outcome.row.id);
  }

  async addNote(actor: RequestActor, ref: string, body: string): Promise<InternalNote> {
    const note = await withActor(this.db, actor.db, async (tx) => {
      const row = await findTicket(tx, ref);
      if (!row) throw Errors.notFound('Ticket');
      const [inserted] = await tx
        .insert(ticketNotes)
        .values({ ticketId: row.id, authorId: actor.profileId, body })
        .returning();
      await insertEvents(tx, [
        {
          ticketId: row.id,
          actorType: 'admin',
          actorId: actor.profileId,
          type: 'ticket.note_added',
          visibility: 'internal',
          payload: { noteId: inserted!.id },
        },
      ]);
      return inserted!;
    });
    return {
      id: note.id,
      body: note.body,
      author: { id: actor.profileId, displayName: actor.displayName, role: 'admin', title: actor.title },
      createdAt: note.createdAt.toISOString(),
    };
  }

  async listNotes(actor: RequestActor, ref: string): Promise<InternalNote[]> {
    return withActor(
      this.db,
      actor.db,
      async (tx) => {
        const row = await findTicket(tx, ref);
        if (!row) throw Errors.notFound('Ticket');
        return (await loadNotes(tx, row.id)).map(toNote);
      },
      { readOnly: true },
    );
  }

  /** Resolves a ticket ref to its id for the caller (404 if not visible to them). */
  async resolveId(actor: RequestActor, ref: string): Promise<string> {
    const row = await withActor(this.db, actor.db, (tx) => findTicket(tx, ref), { readOnly: true });
    if (!row) throw Errors.notFound('Ticket');
    return row.id;
  }

  private async authorContactFor(authorId: string): Promise<{ profileId: string; email: string } | null> {
    const [row] = await withActor(
      this.db,
      { kind: 'system' },
      (tx) =>
        tx
          .select({ profileId: profiles.id, email: profiles.email })
          .from(profiles)
          .where(eq(profiles.authorId, authorId))
          .limit(1),
      { readOnly: true },
    );
    return row ?? null;
  }
}
