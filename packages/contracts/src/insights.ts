import { z } from 'zod';
import { IsoDateSchema } from './common';
import { AI_TASKS, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from './enums';

const count = z.number().int();
const nullableNumber = z.number().nullable();

export const InsightsQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(90).default(30),
});

export const InsightsResponseSchema = z
  .object({
    range: z.object({ from: IsoDateSchema, to: IsoDateSchema, days: count }),
    tickets: z.object({
      total: count,
      created: count,
      resolved: count,
      unresolved: count,
      byStatus: z.record(z.enum(TICKET_STATUSES), count),
      byCategory: z.array(z.object({ category: z.enum(TICKET_CATEGORIES), count })),
      byPriority: z.array(z.object({ priority: z.enum(TICKET_PRIORITIES), count })),
      daily: z.array(z.object({ date: IsoDateSchema, created: count, resolved: count })),
    }),
    responsiveness: z.object({
      medianFirstResponseMinutes: nullableNumber,
      p90FirstResponseMinutes: nullableNumber,
      medianResolutionHours: nullableNumber,
      slaComplianceRate: nullableNumber,
      breachingNow: count,
    }),
    satisfaction: z.object({
      ratings: count,
      positiveRate: nullableNumber,
    }),
    ai: z.object({
      triaged: count,
      triagedByAi: count,
      triagedByRules: count,
      categoryOverrideRate: nullableNumber,
      priorityOverrideRate: nullableNumber,
      repliesSent: count,
      repliesFromDraft: count,
      draftAdoptionRate: nullableNumber,
      /** 0 = sent unchanged, 1 = fully rewritten. */
      medianDraftEditRatio: nullableNumber,
      draftsSentUnchanged: count,
      injectionFlags: count,
      assistQuestions: count,
      assistResolvedRate: nullableNumber,
    }),
    usage: z.object({
      calls: count,
      failures: count,
      fallbacks: count,
      inputTokens: count,
      outputTokens: count,
      avgInputTokensPerDraft: nullableNumber,
      /** What the same drafts would have cost with the naive "send everything" context. */
      avgBaselineInputTokensPerDraft: nullableNumber,
      contextSavingsRate: nullableNumber,
      estimatedCostUsd: z.number(),
      estimatedCostAtPaidRatesUsd: z.number(),
      byTask: z.array(
        z.object({
          task: z.enum(AI_TASKS),
          calls: count,
          failures: count,
          p50LatencyMs: nullableNumber,
          p95LatencyMs: nullableNumber,
          inputTokens: count,
          outputTokens: count,
        }),
      ),
      byProvider: z.array(
        z.object({
          provider: z.string(),
          model: z.string(),
          calls: count,
          failures: count,
          inputTokens: count,
          outputTokens: count,
        }),
      ),
    }),
  })
  .meta({ id: 'Insights' });
export type InsightsResponse = z.infer<typeof InsightsResponseSchema>;
