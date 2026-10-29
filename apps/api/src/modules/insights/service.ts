import {
  AI_TASKS,
  type AiTask,
  type InsightsResponse,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from '@bookleaf/contracts';
import { type Database, rowsOf, type Transaction, withActor } from '@bookleaf/db';
import { addDays, startOfUtcDay, toIsoDate } from '@bookleaf/domain';
import { type SQL, sql } from 'drizzle-orm';
import type { RequestActor } from '../../http/context';
import type { Clock } from '../../lib/clock';

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const maybe = (v: unknown): number | null =>
  v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100;
const rate = (part: number, whole: number): number | null =>
  whole > 0 ? Math.round((part / whole) * 1000) / 1000 : null;

async function rows<T>(tx: Transaction, query: SQL): Promise<T[]> {
  return rowsOf<T>(await tx.execute(query));
}

/**
 * Operations and AI-quality metrics. The AI section is how Leaf is held accountable in
 * production: override rates (classification accuracy as judged by the team), draft adoption and
 * edit distance (draft quality), fallback rate (reliability) and tokens vs. the naive baseline
 * (cost discipline).
 */
export class InsightsService {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly paidTier: boolean,
  ) {}

  async get(actor: RequestActor, days: number): Promise<InsightsResponse> {
    const now = this.clock.now();
    const to = startOfUtcDay(now);
    const from = addDays(to, -(days - 1));
    const end = addDays(to, 1);
    const inRange = (column: string) =>
      sql`${sql.raw(column)} >= ${from}::timestamptz and ${sql.raw(column)} < ${end}::timestamptz`;

    return withActor(
      this.db,
      actor.db,
      async (tx) => {
        const [totals] = await rows<Record<string, number>>(
          tx,
          sql`select count(*)::int as total,
                count(*) filter (where ${inRange('created_at')})::int as created,
                count(*) filter (where ${inRange('resolved_at')})::int as resolved,
                count(*) filter (where status in ('open', 'in_progress'))::int as unresolved,
                count(*) filter (where status = 'open')::int as s_open,
                count(*) filter (where status = 'in_progress')::int as s_in_progress,
                count(*) filter (where status = 'resolved')::int as s_resolved,
                count(*) filter (where status = 'closed')::int as s_closed,
                count(*) filter (where status in ('open', 'in_progress') and first_response_at is null
                                   and sla_due_at < ${now}::timestamptz)::int as breaching
              from app.tickets`,
        );

        const byCategory = await rows<{ category: TicketCategory; count: number }>(
          tx,
          sql`select category, count(*)::int as count from app.tickets
               where ${inRange('created_at')} and category is not null
               group by category order by count desc`,
        );
        const byPriority = await rows<{ priority: TicketPriority; count: number }>(
          tx,
          sql`select priority, count(*)::int as count from app.tickets
               where ${inRange('created_at')} and priority is not null
               group by priority`,
        );
        const daily = await rows<{ date: string; created: number; resolved: number }>(
          tx,
          sql`with days as (select generate_series(${toIsoDate(from)}::date, ${toIsoDate(to)}::date, interval '1 day')::date as day)
              select to_char(d.day, 'YYYY-MM-DD') as date,
                     (select count(*)::int from app.tickets t where t.created_at >= d.day and t.created_at < d.day + 1) as created,
                     (select count(*)::int from app.tickets t where t.resolved_at >= d.day and t.resolved_at < d.day + 1) as resolved
                from days d order by d.day`,
        );

        const [quality] = await rows<Record<string, number | null>>(
          tx,
          sql`select
                percentile_cont(0.5) within group (order by extract(epoch from (first_response_at - created_at)) / 60)
                  filter (where first_response_at is not null) as median_first,
                percentile_cont(0.9) within group (order by extract(epoch from (first_response_at - created_at)) / 60)
                  filter (where first_response_at is not null) as p90_first,
                percentile_cont(0.5) within group (order by extract(epoch from (resolved_at - created_at)) / 3600)
                  filter (where resolved_at is not null) as median_resolution,
                count(*) filter (where first_response_at is not null and sla_due_at is not null and first_response_at <= sla_due_at)::int as sla_met,
                count(*) filter (where first_response_at is not null and sla_due_at is not null)::int as sla_total,
                count(*) filter (where feedback_rating is not null)::int as ratings,
                count(*) filter (where feedback_rating = 1)::int as positive,
                count(*) filter (where triage_status = 'completed')::int as triaged,
                count(*) filter (where triage_status = 'completed' and triage_provider is not null)::int as triaged_ai,
                count(*) filter (where triage_status = 'completed' and triage_provider is null)::int as triaged_rules,
                count(*) filter (where ai_category is not null)::int as with_ai_category,
                count(*) filter (where category_source = 'admin' and ai_category is not null and ai_category <> category)::int as category_overrides,
                count(*) filter (where ai_priority is not null)::int as with_ai_priority,
                count(*) filter (where priority_source = 'admin' and ai_priority is not null and ai_priority <> priority)::int as priority_overrides,
                count(*) filter (where 'possible_injection'::app.ai_flag = any(ai_flags))::int as injection_flags
              from app.tickets where ${inRange('created_at')}`,
        );

        const [replies] = await rows<Record<string, number | null>>(
          tx,
          sql`select count(*)::int as sent,
                count(*) filter (where draft_id is not null)::int as from_draft,
                percentile_cont(0.5) within group (order by draft_edit_ratio) filter (where draft_edit_ratio is not null) as median_edit,
                count(*) filter (where draft_edit_ratio is not null and draft_edit_ratio <= 0.05)::int as unchanged
              from app.ticket_messages where sender_type = 'admin' and ${inRange('created_at')}`,
        );

        const [assist] = await rows<Record<string, number>>(
          tx,
          sql`select
                (select count(*)::int from app.assist_messages where role = 'author' and ${inRange('created_at')}) as questions,
                (select count(*)::int from app.assist_conversations where ${inRange('created_at')}) as conversations,
                (select count(*)::int from app.assist_conversations where resolved and ${inRange('created_at')}) as resolved`,
        );

        const [usage] = await rows<Record<string, number | null>>(
          tx,
          sql`select count(*)::int as calls,
                count(*) filter (where outcome = 'error')::int as failures,
                count(*) filter (where outcome = 'fallback')::int as fallbacks,
                coalesce(sum(input_tokens), 0)::bigint as input_tokens,
                coalesce(sum(output_tokens + reasoning_tokens), 0)::bigint as output_tokens,
                coalesce(sum(estimated_cost_usd), 0)::float8 as cost,
                avg((metadata->>'inputTokensEstimate')::numeric) filter (where task = 'draft' and outcome in ('success', 'fallback'))::float8 as avg_draft_input,
                avg((metadata->>'baselineInputTokens')::numeric) filter (where task = 'draft' and outcome in ('success', 'fallback'))::float8 as avg_draft_baseline
              from app.ai_runs where ${inRange('created_at')}`,
        );

        const byTask = await rows<Record<string, number | string | null>>(
          tx,
          sql`select task, count(*)::int as calls,
                count(*) filter (where outcome = 'error')::int as failures,
                percentile_cont(0.5) within group (order by latency_ms) filter (where outcome in ('success', 'fallback')) as p50,
                percentile_cont(0.95) within group (order by latency_ms) filter (where outcome in ('success', 'fallback')) as p95,
                coalesce(sum(input_tokens), 0)::bigint as input_tokens,
                coalesce(sum(output_tokens + reasoning_tokens), 0)::bigint as output_tokens
              from app.ai_runs where ${inRange('created_at')}
              group by task order by calls desc`,
        );

        const byProvider = await rows<Record<string, number | string>>(
          tx,
          sql`select provider, model, count(*)::int as calls,
                count(*) filter (where outcome = 'error')::int as failures,
                coalesce(sum(input_tokens), 0)::bigint as input_tokens,
                coalesce(sum(output_tokens + reasoning_tokens), 0)::bigint as output_tokens
              from app.ai_runs where ${inRange('created_at')} and outcome <> 'skipped'
              group by provider, model order by calls desc limit 12`,
        );

        const t = totals ?? {};
        const q = quality ?? {};
        const r = replies ?? {};
        const u = usage ?? {};
        const a = assist ?? {};
        const byStatus = Object.fromEntries(TICKET_STATUSES.map((s) => [s, 0])) as Record<
          TicketStatus,
          number
        >;
        byStatus.open = num(t.s_open);
        byStatus.in_progress = num(t.s_in_progress);
        byStatus.resolved = num(t.s_resolved);
        byStatus.closed = num(t.s_closed);
        const avgInput = maybe(u.avg_draft_input);
        const avgBaseline = maybe(u.avg_draft_baseline);
        const paidRatesCost = Math.round(num(u.cost) * 10_000) / 10_000;

        return {
          range: { from: toIsoDate(from), to: toIsoDate(to), days },
          tickets: {
            total: num(t.total),
            created: num(t.created),
            resolved: num(t.resolved),
            unresolved: num(t.unresolved),
            byStatus,
            byCategory: byCategory
              .filter((c) => TICKET_CATEGORIES.includes(c.category))
              .map((c) => ({ category: c.category, count: num(c.count) })),
            byPriority: TICKET_PRIORITIES.map((p) => ({
              priority: p,
              count: num(byPriority.find((x) => x.priority === p)?.count),
            })),
            daily: daily.map((d) => ({ date: d.date, created: num(d.created), resolved: num(d.resolved) })),
          },
          responsiveness: {
            medianFirstResponseMinutes: maybe(q.median_first),
            p90FirstResponseMinutes: maybe(q.p90_first),
            medianResolutionHours: maybe(q.median_resolution),
            slaComplianceRate: rate(num(q.sla_met), num(q.sla_total)),
            breachingNow: num(t.breaching),
          },
          satisfaction: { ratings: num(q.ratings), positiveRate: rate(num(q.positive), num(q.ratings)) },
          ai: {
            triaged: num(q.triaged),
            triagedByAi: num(q.triaged_ai),
            triagedByRules: num(q.triaged_rules),
            categoryOverrideRate: rate(num(q.category_overrides), num(q.with_ai_category)),
            priorityOverrideRate: rate(num(q.priority_overrides), num(q.with_ai_priority)),
            repliesSent: num(r.sent),
            repliesFromDraft: num(r.from_draft),
            draftAdoptionRate: rate(num(r.from_draft), num(r.sent)),
            medianDraftEditRatio: maybe(r.median_edit),
            draftsSentUnchanged: num(r.unchanged),
            injectionFlags: num(q.injection_flags),
            assistQuestions: num(a.questions),
            assistResolvedRate: rate(num(a.resolved), num(a.conversations)),
          },
          usage: {
            calls: num(u.calls),
            failures: num(u.failures),
            fallbacks: num(u.fallbacks),
            inputTokens: num(u.input_tokens),
            outputTokens: num(u.output_tokens),
            avgInputTokensPerDraft: avgInput,
            avgBaselineInputTokensPerDraft: avgBaseline,
            contextSavingsRate:
              avgInput !== null && avgBaseline !== null && avgBaseline > 0
                ? Math.round((1 - avgInput / avgBaseline) * 1000) / 1000
                : null,
            estimatedCostUsd: this.paidTier ? paidRatesCost : 0,
            estimatedCostAtPaidRatesUsd: paidRatesCost,
            byTask: byTask
              .filter((row) => AI_TASKS.includes(row.task as AiTask))
              .map((row) => ({
                task: row.task as AiTask,
                calls: num(row.calls),
                failures: num(row.failures),
                p50LatencyMs: maybe(row.p50),
                p95LatencyMs: maybe(row.p95),
                inputTokens: num(row.input_tokens),
                outputTokens: num(row.output_tokens),
              })),
            byProvider: byProvider.map((row) => ({
              provider: String(row.provider),
              model: String(row.model),
              calls: num(row.calls),
              failures: num(row.failures),
              inputTokens: num(row.input_tokens),
              outputTokens: num(row.output_tokens),
            })),
          },
        };
      },
      { readOnly: true },
    );
  }
}
