import { index, integer, jsonb, numeric, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt } from './columns';
import { aiRunOutcome, aiTask, app } from './enums';
import { aiDrafts, tickets } from './tickets';

/** One row per LLM / embedding / guard call — the basis for cost, latency and reliability metrics. */
export const aiRuns = app.table(
  'ai_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id').references(() => tickets.id, { onDelete: 'set null' }),
    draftId: uuid('draft_id').references(() => aiDrafts.id, { onDelete: 'set null' }),
    task: aiTask('task').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version'),
    outcome: aiRunOutcome('outcome').notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    attempt: integer('attempt').notNull().default(1),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    reasoningTokens: integer('reasoning_tokens').notNull().default(0),
    cachedTokens: integer('cached_tokens').notNull().default(0),
    latencyMs: integer('latency_ms'),
    /** What this call would cost at the provider's paid list price (free tiers bill $0). */
    estimatedCostUsd: numeric('estimated_cost_usd', { precision: 14, scale: 8, mode: 'number' })
      .notNull()
      .default(0),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index('ai_runs_created_idx').on(t.createdAt),
    index('ai_runs_task_created_idx').on(t.task, t.createdAt),
    index('ai_runs_ticket_idx').on(t.ticketId),
  ],
);
