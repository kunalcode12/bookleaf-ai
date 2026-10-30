import {
  type AdminTicketListQuery,
  type AuthorTicketListQuery,
  parseTicketNumber,
  type QueueStats,
  type TicketEventType,
} from '@bookleaf/contracts';
import { type Executor, rowsOf, schema, tstz } from '@bookleaf/db';
import { addDays } from '@bookleaf/domain';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

const {
  tickets,
  authors,
  books,
  profiles,
  ticketMessages,
  ticketNotes,
  ticketEvents,
  ticketAttachments,
  aiDrafts,
} = schema;
const assignee = alias(profiles, 'assignee');

const UNRESOLVED = sql`${tickets.status} in ('open', 'in_progress')`;
/** 25% of each priority's first-response window — the "at risk" threshold (matches domain/sla). */
const AT_RISK_WINDOW = sql`(case ${tickets.priority} when 'critical' then interval '1 hour' when 'high' then interval '3 hours' when 'medium' then interval '6 hours' else interval '12 hours' end)`;

export const ticketColumns = {
  id: tickets.id,
  number: tickets.number,
  authorId: tickets.authorId,
  bookId: tickets.bookId,
  createdById: tickets.createdById,
  subject: tickets.subject,
  description: tickets.description,
  status: tickets.status,
  category: tickets.category,
  categorySource: tickets.categorySource,
  priority: tickets.priority,
  prioritySource: tickets.prioritySource,
  secondaryCategory: tickets.secondaryCategory,
  aiCategory: tickets.aiCategory,
  aiPriority: tickets.aiPriority,
  aiConfidence: tickets.aiConfidence,
  aiSummary: tickets.aiSummary,
  aiRationale: tickets.aiRationale,
  aiSentiment: tickets.aiSentiment,
  aiLanguage: tickets.aiLanguage,
  aiSignals: tickets.aiSignals,
  aiFlags: tickets.aiFlags,
  policyAdjustments: tickets.policyAdjustments,
  injection: tickets.injection,
  triageStatus: tickets.triageStatus,
  triageAttempts: tickets.triageAttempts,
  triageError: tickets.triageError,
  triageProvider: tickets.triageProvider,
  triageModel: tickets.triageModel,
  triagedAt: tickets.triagedAt,
  draftStatus: tickets.draftStatus,
  assigneeId: tickets.assigneeId,
  slaDueAt: tickets.slaDueAt,
  firstResponseAt: tickets.firstResponseAt,
  resolvedAt: tickets.resolvedAt,
  closedAt: tickets.closedAt,
  lastAuthorMessageAt: tickets.lastAuthorMessageAt,
  lastAdminMessageAt: tickets.lastAdminMessageAt,
  authorLastReadAt: tickets.authorLastReadAt,
  messageCount: tickets.messageCount,
  threadVersion: tickets.threadVersion,
  contextSummary: tickets.contextSummary,
  contextSummaryUpTo: tickets.contextSummaryUpTo,
  feedbackRating: tickets.feedbackRating,
  feedbackComment: tickets.feedbackComment,
  feedbackAt: tickets.feedbackAt,
  version: tickets.version,
  createdAt: tickets.createdAt,
  updatedAt: tickets.updatedAt,
  hasEmbedding: sql<boolean>`${tickets.embedding} is not null`,
  authorName: authors.name,
  authorExternalId: authors.externalId,
  authorEmail: authors.email,
  bookExternalId: books.externalId,
  bookTitle: books.title,
  bookStage: books.stage,
  assigneeName: assignee.displayName,
  assigneeTitle: assignee.title,
  hasAttachments: sql<boolean>`exists (select 1 from ${ticketAttachments} where ${ticketAttachments.ticketId} = ${tickets.id} and ${ticketAttachments.status} = 'attached')`,
};

function selectTickets(tx: Executor) {
  return tx
    .select(ticketColumns)
    .from(tickets)
    .innerJoin(authors, eq(authors.id, tickets.authorId))
    .leftJoin(books, eq(books.id, tickets.bookId))
    .leftJoin(assignee, eq(assignee.id, tickets.assigneeId));
}

export type TicketRow = Awaited<ReturnType<typeof selectTickets>>[number];

export function ticketRefWhere(ref: string): SQL {
  const number = parseTicketNumber(ref);
  return number !== null ? eq(tickets.number, number) : eq(tickets.id, ref);
}

export async function findTicket(
  tx: Executor,
  ref: string,
  opts: { forUpdate?: boolean } = {},
): Promise<TicketRow | null> {
  let where = ticketRefWhere(ref);
  if (opts.forUpdate) {
    // Lock just the ticket row first: Postgres can't lock the nullable side of the outer joins
    // below, and rejects schema-qualified names in `FOR UPDATE OF`.
    const [locked] = await tx.select({ id: tickets.id }).from(tickets).where(where).for('update');
    if (!locked) return null;
    where = eq(tickets.id, locked.id);
  }
  const [row] = await selectTickets(tx).where(where).limit(1);
  return row ?? null;
}

/** Same formula as domain/urgency.ts, evaluated in SQL so the queue can sort and page by it. */
export function urgencySql(now: Date): SQL<number> {
  return sql<number>`(case when ${tickets.status} in ('resolved', 'closed') then 0 else least(100,
    (case ${tickets.priority} when 'critical' then 80 when 'high' then 60 when 'medium' then 40 when 'low' then 20 else 50 end)
    + least(12, floor(extract(epoch from (${tstz(now)} - ${tickets.createdAt})) / 21600))::int
    + (case when ${tickets.firstResponseAt} is null and ${tickets.slaDueAt} is not null and ${tickets.slaDueAt} < ${tstz(now)} then 8 else 0 end)
  ) end)`;
}

const PRIORITY_ORDER = sql`(case ${tickets.priority} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else -1 end)`;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listAdminTickets(
  tx: Executor,
  query: AdminTicketListQuery,
  ctx: { profileId: string; now: Date; offset: number },
): Promise<{ rows: TicketRow[]; hasMore: boolean }> {
  const where: SQL[] = [];
  if (query.status) where.push(inArray(tickets.status, query.status));
  if (query.category) where.push(inArray(tickets.category, query.category));
  if (query.priority) where.push(inArray(tickets.priority, query.priority));
  if (query.assignee === 'me') where.push(eq(tickets.assigneeId, ctx.profileId));
  else if (query.assignee === 'unassigned') where.push(isNull(tickets.assigneeId));
  else if (query.assignee) where.push(eq(tickets.assigneeId, query.assignee));
  if (query.createdFrom) where.push(gte(tickets.createdAt, new Date(`${query.createdFrom}T00:00:00Z`)));
  if (query.createdTo)
    where.push(lt(tickets.createdAt, addDays(new Date(`${query.createdTo}T00:00:00Z`), 1)));
  if (query.authorId) where.push(eq(tickets.authorId, query.authorId));
  if (query.flag) where.push(sql`${query.flag}::app.ai_flag = any(${tickets.aiFlags})`);
  if (query.sla === 'breached') {
    where.push(
      sql`${UNRESOLVED} and ${tickets.firstResponseAt} is null and ${tickets.slaDueAt} < ${tstz(ctx.now)}`,
    );
  } else if (query.sla === 'at_risk') {
    where.push(
      sql`${UNRESOLVED} and ${tickets.firstResponseAt} is null and ${tickets.slaDueAt} >= ${tstz(ctx.now)} and ${tickets.slaDueAt} - ${tstz(ctx.now)} < ${AT_RISK_WINDOW}`,
    );
  }
  if (query.q) {
    const number = parseTicketNumber(query.q);
    if (number !== null) {
      where.push(eq(tickets.number, number));
    } else {
      const like = `%${escapeLike(query.q)}%`;
      where.push(
        or(
          sql`${tickets.search} @@ websearch_to_tsquery('english', ${query.q})`,
          ilike(tickets.subject, like),
          ilike(authors.name, like),
          ilike(books.title, like),
        )!,
      );
    }
  }

  const order: SQL[] = (() => {
    switch (query.sort) {
      case 'newest':
        return [desc(tickets.createdAt)];
      case 'oldest':
        return [asc(tickets.createdAt)];
      case 'updated':
        return [desc(tickets.updatedAt)];
      case 'priority':
        return [desc(UNRESOLVED), asc(PRIORITY_ORDER), asc(tickets.createdAt)];
      default:
        // Most urgent first; within the same urgency, the oldest waits least.
        return [desc(UNRESOLVED), desc(urgencySql(ctx.now)), asc(tickets.createdAt)];
    }
  })();

  const rows = await selectTickets(tx)
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(...order, asc(tickets.id))
    .limit(query.limit + 1)
    .offset(ctx.offset);
  return { rows: rows.slice(0, query.limit), hasMore: rows.length > query.limit };
}

export async function listAuthorTickets(
  tx: Executor,
  authorId: string,
  query: AuthorTicketListQuery,
  offset: number,
): Promise<{ rows: TicketRow[]; hasMore: boolean }> {
  const where: SQL[] = [eq(tickets.authorId, authorId)];
  if (query.status === 'active') where.push(UNRESOLVED);
  else if (query.status) where.push(eq(tickets.status, query.status));
  const lastActivity = sql`greatest(${tickets.createdAt}, coalesce(${tickets.lastAdminMessageAt}, ${tickets.createdAt}), coalesce(${tickets.lastAuthorMessageAt}, ${tickets.createdAt}))`;
  const rows = await selectTickets(tx)
    .where(and(...where))
    .orderBy(desc(UNRESOLVED), desc(lastActivity), asc(tickets.id))
    .limit(query.limit + 1)
    .offset(offset);
  return { rows: rows.slice(0, query.limit), hasMore: rows.length > query.limit };
}

export async function queueStats(tx: Executor, profileId: string, now: Date): Promise<QueueStats> {
  const [row] = await tx
    .select({
      unresolved: sql<number>`count(*) filter (where ${UNRESOLVED})::int`,
      open: sql<number>`count(*) filter (where ${tickets.status} = 'open')::int`,
      inProgress: sql<number>`count(*) filter (where ${tickets.status} = 'in_progress')::int`,
      critical: sql<number>`count(*) filter (where ${UNRESOLVED} and ${tickets.priority} = 'critical')::int`,
      high: sql<number>`count(*) filter (where ${UNRESOLVED} and ${tickets.priority} = 'high')::int`,
      breaching: sql<number>`count(*) filter (where ${UNRESOLVED} and ${tickets.firstResponseAt} is null and ${tickets.slaDueAt} < ${tstz(now)})::int`,
      atRisk: sql<number>`count(*) filter (where ${UNRESOLVED} and ${tickets.firstResponseAt} is null and ${tickets.slaDueAt} >= ${tstz(now)} and ${tickets.slaDueAt} - ${tstz(now)} < ${AT_RISK_WINDOW})::int`,
      unassigned: sql<number>`count(*) filter (where ${UNRESOLVED} and ${tickets.assigneeId} is null)::int`,
      mine: sql<number>`count(*) filter (where ${UNRESOLVED} and ${tickets.assigneeId} = ${profileId})::int`,
      needsReview: sql<number>`count(*) filter (where ${UNRESOLVED} and 'needs_review'::app.ai_flag = any(${tickets.aiFlags}))::int`,
      awaitingTriage: sql<number>`count(*) filter (where ${tickets.triageStatus} in ('pending', 'processing'))::int`,
      possibleInjection: sql<number>`count(*) filter (where ${UNRESOLVED} and 'possible_injection'::app.ai_flag = any(${tickets.aiFlags}))::int`,
      resolvedToday: sql<number>`count(*) filter (where ${tickets.resolvedAt} >= date_trunc('day', ${tstz(now)}))::int`,
    })
    .from(tickets);
  return row!;
}

export async function loadMessages(tx: Executor, ticketId: string) {
  return tx
    .select()
    .from(ticketMessages)
    .where(eq(ticketMessages.ticketId, ticketId))
    .orderBy(asc(ticketMessages.createdAt), asc(ticketMessages.id));
}

export async function loadNotes(tx: Executor, ticketId: string) {
  return tx
    .select({
      id: ticketNotes.id,
      body: ticketNotes.body,
      createdAt: ticketNotes.createdAt,
      authorId: ticketNotes.authorId,
      authorName: profiles.displayName,
      authorTitle: profiles.title,
    })
    .from(ticketNotes)
    .innerJoin(profiles, eq(profiles.id, ticketNotes.authorId))
    .where(eq(ticketNotes.ticketId, ticketId))
    .orderBy(asc(ticketNotes.createdAt));
}

export async function loadEvents(tx: Executor, ticketId: string, publicOnly: boolean) {
  return tx
    .select({
      id: ticketEvents.id,
      seq: ticketEvents.seq,
      type: ticketEvents.type,
      actorType: ticketEvents.actorType,
      actorId: ticketEvents.actorId,
      actorName: profiles.displayName,
      visibility: ticketEvents.visibility,
      payload: ticketEvents.payload,
      createdAt: ticketEvents.createdAt,
    })
    .from(ticketEvents)
    .leftJoin(profiles, eq(profiles.id, ticketEvents.actorId))
    .where(
      and(
        eq(ticketEvents.ticketId, ticketId),
        publicOnly ? eq(ticketEvents.visibility, 'public') : undefined,
      ),
    )
    .orderBy(asc(ticketEvents.seq));
}

export interface EventInput {
  ticketId: string;
  actorType: 'author' | 'admin' | 'system' | 'ai';
  actorId: string | null;
  type: TicketEventType;
  visibility: 'public' | 'internal';
  payload?: Record<string, unknown>;
}

export async function insertEvents(tx: Executor, events: EventInput[]) {
  if (events.length === 0) return;
  await tx.insert(ticketEvents).values(events.map((e) => ({ ...e, payload: e.payload ?? {} })));
}

export async function loadDrafts(tx: Executor, ticketId: string, limit = 12) {
  return tx
    .select({ draft: aiDrafts, creatorName: profiles.displayName, creatorTitle: profiles.title })
    .from(aiDrafts)
    .leftJoin(profiles, eq(profiles.id, aiDrafts.createdById))
    .where(eq(aiDrafts.ticketId, ticketId))
    .orderBy(desc(aiDrafts.version))
    .limit(limit);
}

export interface SimilarRow {
  id: string;
  number: number;
  subject: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  category: string | null;
  author_name: string;
  similarity: number;
  created_at: Date | string;
}

/** Nearest tickets by embedding (pgvector cosine distance, HNSW index). */
export async function similarTickets(tx: Executor, ticketId: string, limit = 5, minSimilarity = 0.78) {
  const result = await tx.execute(sql`
    select other.id, other.number, other.subject, other.status, other.category, a.name as author_name,
           1 - (other.embedding <=> self.embedding) as similarity, other.created_at
      from ${tickets} self
      join ${tickets} other on other.id <> self.id and other.embedding is not null
      join ${authors} a on a.id = other.author_id
     where self.id = ${ticketId} and self.embedding is not null
     order by other.embedding <=> self.embedding
     limit ${limit}`);
  return rowsOf<SimilarRow>(result).filter((r) => Number(r.similarity) >= minSimilarity);
}
