import type {
  AiFlag,
  GroundingIndex,
  InjectionReport,
  PolicyAdjustment,
  ToneChecklist,
  TriageSignals,
} from '@bookleaf/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  vector,
} from 'drizzle-orm/pg-core';
import { createdAt, EMBEDDING_DIMENSIONS, tsvector, tz, updatedAt } from './columns';
import { authors, books, profiles } from './core';
import {
  actorType,
  aiFlag,
  aiJobStatus,
  app,
  attachmentStatus,
  classificationSource,
  draftOrigin,
  draftStatus,
  escalationTeam,
  eventVisibility,
  messageSender,
  refinePreset,
  sentiment,
  ticketCategory,
  ticketEventType,
  ticketPriority,
  ticketStatus,
} from './enums';

export const tickets = app.table(
  'tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Human reference: BL-1001, BL-1002, … */
    number: integer('number').notNull().unique().generatedAlwaysAsIdentity({ startWith: 1001 }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => authors.id, { onDelete: 'restrict' }),
    /** null = "General / Account Level". */
    bookId: uuid('book_id').references(() => books.id, { onDelete: 'set null' }),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    subject: varchar('subject', { length: 150 }).notNull(),
    description: text('description').notNull(),
    status: ticketStatus('status').notNull().default('open'),

    // Effective classification (what the queue shows) and who set it.
    category: ticketCategory('category'),
    categorySource: classificationSource('category_source'),
    priority: ticketPriority('priority'),
    prioritySource: classificationSource('priority_source'),
    secondaryCategory: ticketCategory('secondary_category'),

    // What Leaf proposed, kept separately so admin overrides stay measurable.
    aiCategory: ticketCategory('ai_category'),
    aiPriority: ticketPriority('ai_priority'),
    aiConfidence: real('ai_confidence'),
    aiSummary: text('ai_summary'),
    aiRationale: text('ai_rationale'),
    aiSentiment: sentiment('ai_sentiment'),
    aiLanguage: text('ai_language'),
    aiSignals: jsonb('ai_signals').$type<TriageSignals>(),
    aiFlags: aiFlag('ai_flags').array().notNull().default(sql`'{}'::app.ai_flag[]`).$type<AiFlag[]>(),
    policyAdjustments: jsonb('policy_adjustments').$type<PolicyAdjustment[]>().notNull().default([]),
    injection: jsonb('injection').$type<InjectionReport>(),

    triageStatus: aiJobStatus('triage_status').notNull().default('pending'),
    triageAttempts: integer('triage_attempts').notNull().default(0),
    triageError: text('triage_error'),
    triageProvider: text('triage_provider'),
    triageModel: text('triage_model'),
    triagedAt: timestamp('triaged_at', tz),
    draftStatus: aiJobStatus('draft_status').notNull().default('pending'),

    assigneeId: uuid('assignee_id').references(() => profiles.id, { onDelete: 'set null' }),
    slaDueAt: timestamp('sla_due_at', tz),
    firstResponseAt: timestamp('first_response_at', tz),
    resolvedAt: timestamp('resolved_at', tz),
    closedAt: timestamp('closed_at', tz),
    lastAuthorMessageAt: timestamp('last_author_message_at', tz),
    lastAdminMessageAt: timestamp('last_admin_message_at', tz),
    authorLastReadAt: timestamp('author_last_read_at', tz),
    messageCount: integer('message_count').notNull().default(0),
    /** Bumped whenever the conversation changes; drafts record the version they were written for. */
    threadVersion: integer('thread_version').notNull().default(1),
    /** Rolling summary of older messages, so long threads don't grow the prompt. */
    contextSummary: text('context_summary'),
    contextSummaryUpTo: integer('context_summary_up_to'),

    feedbackRating: smallint('feedback_rating'),
    feedbackComment: text('feedback_comment'),
    feedbackAt: timestamp('feedback_at', tz),

    /** Idempotency key supplied by the client (Idempotency-Key header). */
    clientRequestId: uuid('client_request_id'),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    search: tsvector('search').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce("subject", '')), 'A') || setweight(to_tsvector('english', coalesce("description", '')), 'B')`,
    ),
    /** Optimistic-concurrency version (ETag). */
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('tickets_queue_idx').on(t.status, t.priority, t.createdAt),
    index('tickets_author_created_idx').on(t.authorId, t.createdAt.desc()),
    index('tickets_book_idx').on(t.bookId),
    index('tickets_assignee_open_idx').on(t.assigneeId).where(sql`${t.status} in ('open', 'in_progress')`),
    index('tickets_sla_open_idx')
      .on(t.slaDueAt)
      .where(sql`${t.firstResponseAt} is null and ${t.status} in ('open', 'in_progress')`),
    index('tickets_triage_pending_idx')
      .on(t.createdAt)
      .where(sql`${t.triageStatus} in ('pending', 'processing')`),
    index('tickets_search_idx').using('gin', t.search),
    index('tickets_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    uniqueIndex('tickets_client_request_key').on(t.authorId, t.clientRequestId),
    check('tickets_subject_length_check', sql`char_length(${t.subject}) between 1 and 150`),
    check('tickets_description_length_check', sql`char_length(${t.description}) between 1 and 5000`),
    check(
      'tickets_feedback_rating_check',
      sql`${t.feedbackRating} is null or ${t.feedbackRating} in (-1, 1)`,
    ),
    check(
      'tickets_confidence_range_check',
      sql`${t.aiConfidence} is null or (${t.aiConfidence} >= 0 and ${t.aiConfidence} <= 1)`,
    ),
  ],
);

export const aiDrafts = app.table(
  'ai_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    status: draftStatus('status').notNull(),
    origin: draftOrigin('origin').notNull().default('ai'),
    body: text('body'),
    preset: refinePreset('preset'),
    instruction: text('instruction'),
    baseDraftId: uuid('base_draft_id'),
    /** tickets.thread_version this draft answers; older than the ticket's = stale. */
    threadVersion: integer('thread_version').notNull(),
    factsUsed: text('facts_used').array().notNull().default(sql`'{}'::text[]`),
    policiesUsed: jsonb('policies_used')
      .$type<Array<{ slug: string; title: string }>>()
      .notNull()
      .default([]),
    needsEscalation: boolean('needs_escalation').notNull().default(false),
    escalationTeam: escalationTeam('escalation_team'),
    internalNextSteps: text('internal_next_steps').array().notNull().default(sql`'{}'::text[]`),
    checks: jsonb('checks').$type<unknown[]>().notNull().default([]),
    checklist: jsonb('checklist').$type<ToneChecklist>(),
    grounding: jsonb('grounding').$type<GroundingIndex>(),
    provider: text('provider'),
    model: text('model'),
    promptVersion: text('prompt_version'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    /** Estimated tokens the naive "send the whole KB + full history" prompt would have used. */
    baselineInputTokens: integer('baseline_input_tokens'),
    latencyMs: integer('latency_ms'),
    error: text('error'),
    createdById: uuid('created_by_id').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ai_drafts_ticket_version_key').on(t.ticketId, t.version),
    index('ai_drafts_ticket_created_idx').on(t.ticketId, t.createdAt.desc()),
  ],
);

export const ticketMessages = app.table(
  'ticket_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    senderType: messageSender('sender_type').notNull(),
    senderId: uuid('sender_id').references(() => profiles.id, { onDelete: 'set null' }),
    // Denormalized so authors can see who replied without reading staff profiles, and so a
    // later name change doesn't rewrite history.
    senderName: text('sender_name').notNull(),
    senderTitle: text('sender_title'),
    body: text('body').notNull(),
    /** The Leaf draft this reply started from (admin replies only). */
    draftId: uuid('draft_id').references(() => aiDrafts.id, { onDelete: 'set null' }),
    /** 0 = draft sent unchanged, 1 = completely rewritten. */
    draftEditRatio: real('draft_edit_ratio'),
    clientRequestId: uuid('client_request_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('ticket_messages_ticket_idx').on(t.ticketId, t.createdAt),
    uniqueIndex('ticket_messages_client_request_key').on(t.ticketId, t.clientRequestId),
    check('ticket_messages_body_length_check', sql`char_length(${t.body}) between 1 and 5000`),
  ],
);

/** Internal notes live in their own table so author-facing code paths cannot even select them. */
export const ticketNotes = app.table(
  'ticket_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('ticket_notes_ticket_idx').on(t.ticketId, t.createdAt),
    check('ticket_notes_body_length_check', sql`char_length(${t.body}) between 1 and 2000`),
  ],
);

export const ticketAttachments = app.table(
  'ticket_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id').references(() => tickets.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').references(() => ticketMessages.id, { onDelete: 'cascade' }),
    uploaderId: uuid('uploader_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    storageKey: text('storage_key').notNull().unique(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    status: attachmentStatus('status').notNull().default('pending'),
    createdAt: createdAt(),
  },
  (t) => [
    index('ticket_attachments_ticket_idx').on(t.ticketId),
    index('ticket_attachments_uploader_idx').on(t.uploaderId, t.status),
    check('ticket_attachments_size_check', sql`${t.sizeBytes} > 0 and ${t.sizeBytes} <= 10485760`),
  ],
);

/** Append-only audit trail. Inserting a row also fires a realtime notification (see migration). */
export const ticketEvents = app.table(
  'ticket_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Monotonic order across all tickets; doubles as the SSE event id. */
    seq: bigint('seq', { mode: 'number' }).notNull().unique().generatedAlwaysAsIdentity(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    actorType: actorType('actor_type').notNull(),
    actorId: uuid('actor_id').references(() => profiles.id, { onDelete: 'set null' }),
    type: ticketEventType('type').notNull(),
    visibility: eventVisibility('visibility').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('ticket_events_ticket_idx').on(t.ticketId, t.createdAt)],
);
