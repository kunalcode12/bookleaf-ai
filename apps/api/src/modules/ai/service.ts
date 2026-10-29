import { type DraftOutcome, type Leaf, type TriageOutcome, VERBATIM_MESSAGES } from '@bookleaf/ai';
import {
  type AiDraft,
  type AiHealth,
  formatTicketNumber,
  type RegenerateDraftRequest,
} from '@bookleaf/contracts';
import { type Database, SYSTEM_ACTOR, schema, type Transaction, withActor } from '@bookleaf/db';
import { escalateOnly, slaDueAt } from '@bookleaf/domain';
import { and, desc, eq, inArray, lt, ne, or, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { RequestActor } from '../../http/context';
import type { JobPayloads } from '../../jobs/definitions';
import type { JobQueue } from '../../jobs/queue';
import type { Clock } from '../../lib/clock';
import { Errors } from '../../lib/errors';
import type { AlertService } from '../alerts/service';
import type { KnowledgeService } from '../knowledge/service';
import type { NotificationService } from '../notifications/service';
import { toDraft } from '../tickets/mapper';
import { findTicket, insertEvents, loadDrafts } from '../tickets/queries';
import { type LoadedTicket, loadTicketInput } from './ticket-input';

const { tickets, aiDrafts } = schema;
const MAX_DRAFT_VERSIONS = 25;

const isUnresolved = (status: string) => status === 'open' || status === 'in_progress';
const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';

export interface DraftStreamCallbacks {
  onStart?: (draft: { id: string; version: number }) => void;
  onDelta?: (text: string) => void;
  onReset?: () => void;
  signal?: AbortSignal;
}

/**
 * Orchestrates Leaf around the ticket lifecycle: background triage and drafting jobs, interactive
 * regeneration, and housekeeping. Admin decisions always win — an override is never overwritten
 * by a later AI pass.
 */
export class TicketAiService {
  constructor(
    private readonly deps: {
      db: Database;
      leaf: Leaf;
      knowledge: KnowledgeService;
      queue: JobQueue;
      clock: Clock;
      notifications: NotificationService;
      alerts: AlertService;
      logger: Logger;
    },
  ) {}

  health(): AiHealth {
    return this.deps.leaf.health();
  }

  private load(ref: string, actor = SYSTEM_ACTOR): Promise<LoadedTicket | null> {
    return withActor(this.deps.db, actor, (tx) => loadTicketInput(tx, ref), { readOnly: true });
  }

  // ─── Triage ────────────────────────────────────────────────────────────────

  async runTriage(ticketId: string, reason: JobPayloads['ticket.triage']['reason']): Promise<void> {
    const { db, leaf, queue, clock, logger } = this.deps;
    const loaded = await this.load(ticketId);
    if (!loaded) return;
    const { input, row } = loaded;
    if (row.status === 'closed') return;
    if (reason === 'sweep' && row.triageStatus !== 'pending') return;
    if (reason === 'retry' && row.triageProvider !== null && row.triageStatus === 'completed') return;
    // A follow-up before the first triage finished: the pending first pass will cover it.
    if (reason === 'followup' && row.triageStatus !== 'completed') return;

    await withActor(db, SYSTEM_ACTOR, (tx) =>
      tx
        .update(tickets)
        .set({
          triageStatus: 'processing',
          triageAttempts: sql`${tickets.triageAttempts} + 1`,
        })
        .where(eq(tickets.id, ticketId)),
    );

    const followUp =
      reason === 'followup'
        ? ([...input.messages].reverse().find((m) => m.sender === 'author')?.body ?? null)
        : null;

    let outcome: TriageOutcome;
    try {
      outcome = await leaf.triage(input, { context: { ticketId }, followUp });
    } catch (error) {
      await withActor(db, SYSTEM_ACTOR, async (tx) => {
        await tx
          .update(tickets)
          .set({ triageStatus: 'failed', triageError: (error as Error).message.slice(0, 300) })
          .where(eq(tickets.id, ticketId));
        await insertEvents(tx, [
          {
            ticketId,
            actorType: 'ai',
            actorId: null,
            type: 'ticket.triage_failed',
            visibility: 'internal',
            payload: { reason },
          },
        ]);
      });
      throw error;
    }

    const embedding =
      !row.hasEmbedding || reason === 'manual'
        ? ((await leaf.embed([`${input.subject}\n\n${input.description}`], 'document', { ticketId }))?.[0] ??
          null)
        : null;

    const now = clock.now();
    const applied = await withActor(db, SYSTEM_ACTOR, async (tx) => {
      const fresh = await findTicket(tx, ticketId, { forUpdate: true });
      if (!fresh) return null;
      const categoryLocked = fresh.categorySource === 'admin';
      const priorityLocked = fresh.prioritySource === 'admin';
      // Follow-ups keep the category stable and may only raise priority.
      const category = categoryLocked
        ? fresh.category!
        : reason === 'followup' && fresh.category
          ? fresh.category
          : outcome.category;
      const proposed =
        reason === 'followup' && fresh.priority
          ? escalateOnly(fresh.priority, outcome.priority)
          : outcome.priority;
      const priority = priorityLocked ? fresh.priority! : proposed;
      const categoryChanged = category !== fresh.category;
      const priorityChanged = priority !== fresh.priority;

      await tx
        .update(tickets)
        .set({
          category,
          categorySource: categoryLocked
            ? 'admin'
            : categoryChanged || !fresh.categorySource
              ? outcome.source
              : fresh.categorySource,
          priority,
          prioritySource: priorityLocked
            ? 'admin'
            : priorityChanged || !fresh.prioritySource
              ? outcome.source
              : fresh.prioritySource,
          secondaryCategory: outcome.secondaryCategory,
          aiCategory: outcome.proposedCategory,
          aiPriority: outcome.proposedPriority,
          aiConfidence: outcome.confidence,
          aiSummary: outcome.summary,
          aiRationale: outcome.rationale,
          aiSentiment: outcome.sentiment,
          aiLanguage: outcome.language,
          aiSignals: outcome.signals,
          aiFlags: outcome.flags,
          policyAdjustments: outcome.policyAdjustments,
          injection: outcome.injection,
          triageStatus: 'completed',
          triageError: outcome.aiError,
          triageProvider: outcome.provider,
          triageModel: outcome.model,
          triagedAt: now,
          // Once BookLeaf has responded the deadline is history; it is only filled in if it was never set.
          slaDueAt:
            fresh.firstResponseAt && fresh.slaDueAt ? fresh.slaDueAt : slaDueAt(fresh.createdAt, priority),
          ...(embedding ? { embedding } : {}),
          ...(categoryChanged || priorityChanged ? { version: fresh.version + 1 } : {}),
        })
        .where(eq(tickets.id, ticketId));

      await insertEvents(tx, [
        {
          ticketId,
          actorType: 'ai',
          actorId: null,
          type: 'ticket.triaged',
          visibility: 'internal',
          payload: {
            reason,
            category,
            priority,
            source: outcome.source,
            confidence: outcome.confidence,
            flags: outcome.flags,
            model: outcome.model,
          },
        },
        ...(reason === 'followup' && priorityChanged
          ? [
              {
                ticketId,
                actorType: 'ai' as const,
                actorId: null,
                type: 'ticket.priority_changed' as const,
                visibility: 'internal' as const,
                payload: {
                  from: fresh.priority,
                  to: priority,
                  reason: 'Escalated after the author followed up',
                },
              },
            ]
          : []),
      ]);
      return { fresh, priority };
    });
    if (!applied) return;

    // Rules were used because providers were down: try again with AI later (bounded).
    if (outcome.source === 'rules' && leaf.configured.llm && row.triageAttempts < 3) {
      await queue.send(
        'ticket.triage',
        { ticketId, reason: 'retry' },
        { startAfterSeconds: 300 * (row.triageAttempts + 1), singletonKey: `retry:${ticketId}` },
      );
    }
    if (applied.priority === 'critical' && applied.fresh.priority !== 'critical') {
      await this.deps.notifications.notifyAdmins({
        type: 'ticket_created',
        title: `Critical ticket ${formatTicketNumber(applied.fresh.number)}`,
        body: outcome.summary,
        ticketId,
      });
    }
    // Prepare the first draft in the background so it is ready when an admin opens the ticket.
    if (reason !== 'followup' && isUnresolved(applied.fresh.status)) {
      await queue.send('ticket.draft', { ticketId, reason: 'initial' });
    }
    if (embedding) {
      await this.deps.alerts
        .checkCluster(ticketId)
        .catch((error) => logger.warn({ err: error }, 'cluster check failed'));
    }
  }

  async requestTriage(actor: RequestActor, ref: string): Promise<void> {
    const ticketId = await withActor(this.deps.db, actor.db, async (tx) => {
      const row = await findTicket(tx, ref, { forUpdate: true });
      if (!row) throw Errors.notFound('Ticket');
      if (row.status === 'closed') throw Errors.conflict('TICKET_CLOSED', 'This ticket is closed.');
      await tx.update(tickets).set({ triageStatus: 'pending' }).where(eq(tickets.id, row.id));
      return row.id;
    });
    await this.deps.queue.send('ticket.triage', { ticketId, reason: 'manual' });
  }

  // ─── Drafts ────────────────────────────────────────────────────────────────

  /** Keeps long threads cheap: older messages are replaced by a stored rolling summary. */
  private async refreshSummary(loaded: LoadedTicket): Promise<void> {
    const { input, row } = loaded;
    const needed = input.messages.length - VERBATIM_MESSAGES;
    if (needed <= 0 || (row.contextSummaryUpTo ?? 0) >= needed) return;
    const result = await this.deps.leaf.summarize(input, { context: { ticketId: row.id } });
    if (!result) return;
    input.contextSummary = result.summary;
    await withActor(this.deps.db, SYSTEM_ACTOR, (tx) =>
      tx
        .update(tickets)
        .set({ contextSummary: result.summary, contextSummaryUpTo: result.upTo })
        .where(eq(tickets.id, row.id)),
    );
  }

  private async createDraftRow(
    tx: Transaction,
    values: {
      ticketId: string;
      threadVersion: number;
      createdById: string | null;
      preset?: RegenerateDraftRequest['preset'] | null;
      instruction?: string | null;
      baseDraftId?: string | null;
    },
  ) {
    const [{ count, next }] = (await tx
      .select({
        count: sql<number>`count(*)::int`,
        next: sql<number>`coalesce(max(${aiDrafts.version}), 0)::int + 1`,
      })
      .from(aiDrafts)
      .where(eq(aiDrafts.ticketId, values.ticketId))) as [{ count: number; next: number }];
    if (count >= MAX_DRAFT_VERSIONS) {
      throw Errors.conflict(
        'CONFLICT',
        `This ticket already has ${MAX_DRAFT_VERSIONS} drafts. Edit the latest one instead.`,
      );
    }
    const [row] = await tx
      .insert(aiDrafts)
      .values({
        ticketId: values.ticketId,
        version: next,
        status: 'generating',
        threadVersion: values.threadVersion,
        createdById: values.createdById,
        preset: values.preset ?? null,
        instruction: values.instruction ?? null,
        baseDraftId: values.baseDraftId ?? null,
      })
      .returning({ id: aiDrafts.id, version: aiDrafts.version });
    await tx.update(tickets).set({ draftStatus: 'processing' }).where(eq(tickets.id, values.ticketId));
    return row!;
  }

  /** Creates the draft row, retrying once if a concurrent request took the same version number. */
  private async startDraft(
    actor: Parameters<typeof withActor>[1],
    values: Parameters<TicketAiService['createDraftRow']>[1],
  ) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await withActor(this.deps.db, actor, (tx) => this.createDraftRow(tx, values));
      } catch (error) {
        if (attempt === 0 && isUniqueViolation(error)) continue;
        throw error;
      }
    }
  }

  private async saveOutcome(draftId: string, ticketId: string, outcome: DraftOutcome): Promise<void> {
    await withActor(this.deps.db, SYSTEM_ACTOR, async (tx) => {
      await tx
        .update(aiDrafts)
        .set({
          status: 'ready',
          origin: outcome.origin,
          body: outcome.body,
          factsUsed: outcome.factsUsed,
          policiesUsed: outcome.policiesUsed,
          needsEscalation: outcome.needsEscalation,
          escalationTeam: outcome.escalationTeam,
          internalNextSteps: outcome.internalNextSteps,
          checks: outcome.checks,
          checklist: outcome.checklist,
          grounding: outcome.grounding,
          provider: outcome.provider,
          model: outcome.model,
          promptVersion: outcome.promptVersion,
          inputTokens: outcome.usage?.inputTokens ?? null,
          outputTokens: outcome.usage ? outcome.usage.outputTokens + outcome.usage.reasoningTokens : null,
          baselineInputTokens: outcome.baselineInputTokens,
          latencyMs: outcome.latencyMs,
          error: outcome.aiError,
        })
        .where(eq(aiDrafts.id, draftId));
      await tx
        .update(aiDrafts)
        .set({ status: 'superseded' })
        .where(and(eq(aiDrafts.ticketId, ticketId), eq(aiDrafts.status, 'ready'), ne(aiDrafts.id, draftId)));
      await tx.update(tickets).set({ draftStatus: 'completed' }).where(eq(tickets.id, ticketId));
      await insertEvents(tx, [
        {
          ticketId,
          actorType: 'ai',
          actorId: null,
          type: 'ticket.draft_ready',
          visibility: 'internal',
          payload: { draftId, origin: outcome.origin, model: outcome.model },
        },
      ]);
    });
  }

  private async failDraft(draftId: string, ticketId: string, error: unknown): Promise<void> {
    await withActor(this.deps.db, SYSTEM_ACTOR, async (tx) => {
      await tx
        .update(aiDrafts)
        .set({ status: 'failed', error: (error as Error).message?.slice(0, 300) ?? 'unknown error' })
        .where(eq(aiDrafts.id, draftId));
      await tx.update(tickets).set({ draftStatus: 'failed' }).where(eq(tickets.id, ticketId));
      await insertEvents(tx, [
        {
          ticketId,
          actorType: 'ai',
          actorId: null,
          type: 'ticket.draft_failed',
          visibility: 'internal',
          payload: { draftId },
        },
      ]);
    });
  }

  /** Job: the background draft that is waiting when an admin opens a ticket. */
  async runDraft(ticketId: string, reason: JobPayloads['ticket.draft']['reason']): Promise<void> {
    const loaded = await this.load(ticketId);
    if (!loaded) return;
    const { row } = loaded;
    if (!isUnresolved(row.status)) {
      await withActor(this.deps.db, SYSTEM_ACTOR, (tx) =>
        tx.update(tickets).set({ draftStatus: 'skipped' }).where(eq(tickets.id, ticketId)),
      );
      return;
    }
    if (row.triageStatus !== 'completed') return; // triage enqueues the draft when it finishes
    const drafts = await withActor(this.deps.db, SYSTEM_ACTOR, (tx) => loadDrafts(tx, ticketId, 1), {
      readOnly: true,
    });
    const latest = drafts[0]?.draft;
    if (reason !== 'manual' && latest?.status === 'ready' && latest.threadVersion >= row.threadVersion)
      return;

    await this.refreshSummary(loaded);
    const draft = await this.startDraft(SYSTEM_ACTOR, {
      ticketId,
      threadVersion: row.threadVersion,
      createdById: null,
    });
    try {
      const { sections, examples } = await this.deps.knowledge.forAi();
      const outcome = await this.deps.leaf.draft(
        {
          ticket: loaded.input,
          knowledge: sections,
          examples,
          agent:
            row.assigneeId && row.assigneeName ? { name: row.assigneeName, title: row.assigneeTitle } : null,
          queryEmbedding: loaded.embedding,
        },
        { context: { ticketId, draftId: draft.id } },
      );
      await this.saveOutcome(draft.id, ticketId, outcome);
    } catch (error) {
      await this.failDraft(draft.id, ticketId, error);
      throw error;
    }
  }

  /** Interactive (re)generation for an admin, optionally streamed token by token. */
  async regenerate(
    actor: RequestActor,
    ref: string,
    request: RegenerateDraftRequest,
    stream: DraftStreamCallbacks = {},
  ): Promise<AiDraft> {
    const loaded = await this.load(ref, actor.db);
    if (!loaded) throw Errors.notFound('Ticket');
    const { row } = loaded;
    if (row.status === 'closed')
      throw Errors.conflict('TICKET_CLOSED', 'This ticket is closed. Replies are disabled.');

    const refining = Boolean(request.preset || request.instruction);
    let baseDraft: { id: string; body: string | null } | null = null;
    if (request.baseDraftId || refining) {
      const [base] = await withActor(
        this.deps.db,
        actor.db,
        (tx) =>
          tx
            .select({ id: aiDrafts.id, body: aiDrafts.body })
            .from(aiDrafts)
            .where(
              and(
                eq(aiDrafts.ticketId, row.id),
                request.baseDraftId
                  ? eq(aiDrafts.id, request.baseDraftId)
                  : inArray(aiDrafts.status, ['ready', 'sent']),
              ),
            )
            .orderBy(desc(aiDrafts.version))
            .limit(1),
        { readOnly: true },
      );
      if (request.baseDraftId && !base) throw Errors.notFound('Draft');
      baseDraft = base ?? null;
    }

    await this.refreshSummary(loaded);
    const draft = await this.startDraft(actor.db, {
      ticketId: row.id,
      threadVersion: row.threadVersion,
      createdById: actor.profileId,
      preset: request.preset ?? null,
      instruction: request.instruction ?? null,
      baseDraftId: baseDraft?.id ?? null,
    });
    stream.onStart?.(draft);
    try {
      const { sections, examples } = await this.deps.knowledge.forAi();
      const outcome = await this.deps.leaf.draft(
        {
          ticket: loaded.input,
          knowledge: sections,
          examples,
          agent: { name: actor.displayName, title: actor.title },
          preset: request.preset ?? null,
          instruction: request.instruction ?? null,
          baseDraft: baseDraft?.body ?? null,
          queryEmbedding: loaded.embedding,
        },
        {
          context: { ticketId: row.id, draftId: draft.id },
          onDelta: stream.onDelta,
          onReset: stream.onReset,
          signal: stream.signal,
        },
      );
      await this.saveOutcome(draft.id, row.id, outcome);
    } catch (error) {
      await this.failDraft(draft.id, row.id, error);
      if ((error as { kind?: string }).kind === 'aborted')
        throw Errors.badRequest('Draft generation was cancelled.');
      throw error;
    }
    const latest = await this.latestDraft(actor, row.id);
    if (!latest) throw Errors.notFound('Draft');
    return latest;
  }

  async latestDraft(actor: RequestActor, ref: string): Promise<AiDraft | null> {
    return withActor(
      this.deps.db,
      actor.db,
      async (tx) => {
        const row = await findTicket(tx, ref);
        if (!row) throw Errors.notFound('Ticket');
        return toDraft(await loadDrafts(tx, row.id), row.threadVersion);
      },
      { readOnly: true },
    );
  }

  // ─── Housekeeping ──────────────────────────────────────────────────────────

  /**
   * Scheduled every two minutes: re-enqueue triage that never ran (e.g. the process stopped between
   * commit and pickup) and release drafts stuck in "generating" after a crash.
   */
  async sweep(): Promise<void> {
    const now = this.deps.clock.now();
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60_000);
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60_000);
    const { stuck, abandoned } = await withActor(this.deps.db, SYSTEM_ACTOR, async (tx) => {
      const stuck = await tx
        .select({ id: tickets.id, status: tickets.triageStatus })
        .from(tickets)
        .where(
          or(
            and(eq(tickets.triageStatus, 'pending'), lt(tickets.createdAt, twoMinutesAgo)),
            and(eq(tickets.triageStatus, 'processing'), lt(tickets.updatedAt, tenMinutesAgo)),
          ),
        )
        .limit(50);
      const processing = stuck.filter((t) => t.status === 'processing').map((t) => t.id);
      if (processing.length > 0) {
        await tx.update(tickets).set({ triageStatus: 'pending' }).where(inArray(tickets.id, processing));
      }
      const abandoned = await tx
        .update(aiDrafts)
        .set({ status: 'failed', error: 'Generation did not finish (worker restarted).' })
        .where(and(eq(aiDrafts.status, 'generating'), lt(aiDrafts.createdAt, tenMinutesAgo)))
        .returning({ ticketId: aiDrafts.ticketId });
      if (abandoned.length > 0) {
        await tx
          .update(tickets)
          .set({ draftStatus: 'failed' })
          .where(
            inArray(
              tickets.id,
              abandoned.map((a) => a.ticketId),
            ),
          );
      }
      return { stuck, abandoned };
    });
    for (const ticket of stuck)
      await this.deps.queue.send('ticket.triage', { ticketId: ticket.id, reason: 'sweep' });
    if (stuck.length + abandoned.length > 0) {
      this.deps.logger.info(
        { requeued: stuck.length, abandonedDrafts: abandoned.length },
        'maintenance sweep',
      );
    }
  }
}
