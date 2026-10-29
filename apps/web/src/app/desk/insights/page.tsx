'use client';

import {
  type AI_TASKS,
  type InsightsResponse,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITY_LABELS,
} from '@bookleaf/contracts';
import { ShieldAlert, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { LeafGlyph } from '@/components/brand';
import { ChartTable, Meter, RankedBars, TrendChart } from '@/components/charts';
import { StatTile } from '@/components/money-stat';
import { ErrorState } from '@/components/states';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader, Skeleton } from '@/components/ui/misc';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { useInsights } from '@/lib/api/queries';
import { count, percent, shortDate } from '@/lib/format';
import { cn, plural } from '@/lib/utils';

const TASK_LABELS: Record<(typeof AI_TASKS)[number], string> = {
  triage: 'Triage',
  draft: 'Drafts',
  assist: 'Ask Leaf',
  summarize: 'Thread summaries',
  embed: 'Embeddings',
  guard: 'Injection guard',
  judge: 'Eval judge',
};

function minutes(value: number | null): string {
  if (value === null) return '—';
  if (value < 60) return `${Math.round(value)}m`;
  const hours = value / 60;
  return hours < 48 ? `${hours.toFixed(hours < 10 ? 1 : 0)}h` : `${(hours / 24).toFixed(1)}d`;
}

function compact(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}K` : String(value);
}

function Dashboard({ data }: { data: InsightsResponse }) {
  const { tickets, responsiveness, satisfaction, ai, usage } = data;
  const daily = tickets.daily.map((d) => ({ date: d.date, created: d.created, resolved: d.resolved }));
  const categories = [...tickets.byCategory]
    .sort((a, b) => b.count - a.count)
    .map((c) => ({ label: TICKET_CATEGORY_LABELS[c.category], value: c.count }));
  const priorities = tickets.byPriority.map((p) => ({
    label: TICKET_PRIORITY_LABELS[p.priority],
    value: p.count,
  }));

  return (
    <div className="space-y-10">
      <section aria-label="Support at a glance" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          tone="ink"
          label="Tickets created"
          value={count(tickets.created)}
          sub={`${count(tickets.unresolved)} still unresolved`}
        />
        <StatTile
          label="Resolved"
          value={count(tickets.resolved)}
          sub={`${count(tickets.byStatus.closed ?? 0)} closed`}
        />
        <StatTile
          label="Median first reply"
          value={minutes(responsiveness.medianFirstResponseMinutes)}
          sub={`90% within ${minutes(responsiveness.p90FirstResponseMinutes)}`}
        />
        <StatTile
          label="Answered within SLA"
          value={percent(responsiveness.slaComplianceRate)}
          sub={`${responsiveness.breachingNow} overdue right now`}
        />
        <StatTile
          label="Authors happy"
          value={percent(satisfaction.positiveRate)}
          sub={
            satisfaction.ratings
              ? `from ${satisfaction.ratings} rating${satisfaction.ratings === 1 ? '' : 's'}`
              : 'No ratings yet'
          }
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardContent>
            <CardTitle className="text-2xl font-black">Volume</CardTitle>
            <CardDescription className="mb-5">New tickets and resolutions per day.</CardDescription>
            <TrendChart
              data={daily}
              xKey="date"
              formatX={(d) => shortDate(d).replace(/ \d{4}$/, '')}
              series={[
                { key: 'created', label: 'Created', color: 'var(--chart-1)' },
                { key: 'resolved', label: 'Resolved', color: 'var(--chart-2)' },
              ]}
            />
            <ChartTable
              caption="Tickets per day"
              columns={['Day', 'Created', 'Resolved']}
              rows={daily.map((d) => [shortDate(d.date), d.created, d.resolved])}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <CardTitle className="text-2xl font-black">What authors ask about</CardTitle>
            <CardDescription className="mb-5">Tickets by category in this period.</CardDescription>
            {categories.length ? (
              <RankedBars data={categories} />
            ) : (
              <p className="text-sm text-muted-foreground">No tickets in this period.</p>
            )}
            <div className="mt-6 border-t pt-5">
              <p className="mb-3 text-sm font-semibold">By priority</p>
              <RankedBars data={priorities} />
            </div>
            <ChartTable
              caption="Tickets by category and priority"
              columns={['Group', 'Tickets']}
              rows={[
                ...categories.map((c) => [c.label, c.value]),
                ...priorities.map((p) => [`Priority: ${p.label}`, p.value]),
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="leaf-title" className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-leaf-ink">
              <LeafGlyph className="size-3.5" /> Leaf accountability
            </p>
            <h2 id="leaf-title" className="mt-2 font-display text-4xl font-black">
              Is the AI earning its keep?
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Every override, edit and fallback is measured. If specialists keep rewriting drafts or
              correcting priorities, it shows up here first.
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card>
            <CardContent className="space-y-5">
              <CardTitle>Triage</CardTitle>
              <p className="text-sm text-muted-foreground">
                {count(ai.triaged)} tickets triaged: {count(ai.triagedByAi)} by Leaf,{' '}
                {count(ai.triagedByRules)} by keyword rules while AI was unavailable.
              </p>
              <Meter
                label="Category kept as triaged"
                value={ai.categoryOverrideRate === null ? null : 1 - ai.categoryOverrideRate}
              />
              <Meter
                label="Priority kept as triaged"
                value={ai.priorityOverrideRate === null ? null : 1 - ai.priorityOverrideRate}
              />
              <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <ShieldAlert className="size-4 text-danger" />{' '}
                {plural(ai.injectionFlags, 'manipulation attempt')} caught
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-5">
              <CardTitle>Drafts</CardTitle>
              <p className="text-sm text-muted-foreground">
                {count(ai.repliesFromDraft)} of {count(ai.repliesSent)} replies started from a Leaf draft;{' '}
                {count(ai.draftsSentUnchanged)} were sent without a single change.
              </p>
              <Meter label="Replies that started from Leaf" value={ai.draftAdoptionRate} />
              <Meter
                label="Draft kept (1 − median edit)"
                value={ai.medianDraftEditRatio === null ? null : 1 - ai.medianDraftEditRatio}
                tone="accent"
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-5">
              <CardTitle>Ask Leaf</CardTitle>
              <p className="text-sm text-muted-foreground">
                {plural(ai.assistQuestions, 'question')} answered for authors before they opened a ticket.
              </p>
              <Meter label="Marked helpful by the author" value={ai.assistResolvedRate} />
              <div className="rounded-xl bg-leaf-soft/60 p-3.5 text-[13px] leading-relaxed text-leaf-ink">
                <Sparkles className="mr-1.5 inline size-3.5" />
                Every one of these is a query the team didn't have to answer by hand.
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="AI calls"
            value={compact(usage.calls)}
            sub={`${usage.failures} failed · ${usage.fallbacks} fell back`}
          />
          <StatTile
            label="Prompt tokens per draft"
            value={
              usage.avgInputTokensPerDraft === null ? '—' : compact(Math.round(usage.avgInputTokensPerDraft))
            }
            sub={
              usage.avgBaselineInputTokensPerDraft
                ? `vs ${compact(Math.round(usage.avgBaselineInputTokensPerDraft))} sending everything`
                : 'Not enough drafts yet'
            }
          />
          <StatTile
            tone="leaf"
            label="Context saved"
            value={percent(usage.contextSavingsRate)}
            sub="by retrieving only relevant policy"
          />
          <StatTile
            label="Spend this period"
            value={`$${usage.estimatedCostUsd.toFixed(2)}`}
            sub={`$${usage.estimatedCostAtPaidRatesUsd.toFixed(2)} at paid list prices`}
          />
        </div>

        <Card>
          <CardContent>
            <CardTitle className="mb-1">Where the calls go</CardTitle>
            <CardDescription className="mb-4">
              Per-task latency and volume, from every logged provider call.
            </CardDescription>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-[13px]">
                <thead>
                  <tr className="border-b text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    <th className="py-2 font-bold">Task</th>
                    <th className="py-2 text-right font-bold">Calls</th>
                    <th className="py-2 text-right font-bold">Failures</th>
                    <th className="py-2 text-right font-bold">p50 latency</th>
                    <th className="py-2 text-right font-bold">p95 latency</th>
                    <th className="py-2 text-right font-bold">Tokens in / out</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {usage.byTask.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-muted-foreground">
                        No AI calls in this period.
                      </td>
                    </tr>
                  ) : (
                    usage.byTask.map((t) => (
                      <tr key={t.task}>
                        <td className="py-2 font-semibold">{TASK_LABELS[t.task]}</td>
                        <td className="py-2 text-right tabular-nums">{count(t.calls)}</td>
                        <td
                          className={cn(
                            'py-2 text-right tabular-nums',
                            t.failures > 0 && 'font-semibold text-warning',
                          )}
                        >
                          {count(t.failures)}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {t.p50LatencyMs === null ? '—' : `${(t.p50LatencyMs / 1000).toFixed(1)}s`}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {t.p95LatencyMs === null ? '—' : `${(t.p95LatencyMs / 1000).toFixed(1)}s`}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {compact(t.inputTokens)} / {compact(t.outputTokens)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {usage.byProvider.length > 0 && (
              <p className="mt-4 text-xs text-muted-foreground">
                Models used:{' '}
                {usage.byProvider.map((p) => `${p.provider} · ${p.model} (${p.calls})`).join(' · ')}
              </p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

export default function InsightsPage() {
  const [days, setDays] = useState(30);
  const insights = useInsights(days);

  return (
    <div className="space-y-8">
      <title>Insights · BookLeaf desk</title>
      <PageHeader
        eyebrow="Insights"
        title="How support is going"
        description={
          insights.data
            ? `${shortDate(insights.data.range.from)} to ${shortDate(insights.data.range.to)}.`
            : 'Responsiveness, author satisfaction and how much Leaf actually helps.'
        }
        actions={
          <Tabs value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <TabsList aria-label="Date range">
              <TabsTrigger value="7">7 days</TabsTrigger>
              <TabsTrigger value="30">30 days</TabsTrigger>
              <TabsTrigger value="90">90 days</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />
      {insights.isError ? (
        <ErrorState error={insights.error} onRetry={() => void insights.refetch()} />
      ) : !insights.data ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-36 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      ) : (
        <div className={cn('transition-opacity', insights.isPlaceholderData && 'opacity-60')}>
          <Dashboard data={insights.data} />
        </div>
      )}
    </div>
  );
}
