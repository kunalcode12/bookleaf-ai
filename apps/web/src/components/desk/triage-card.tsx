'use client';

import {
  type AdminTicketDetail,
  AI_FLAG_LABELS,
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
  type TicketCategory,
  type TicketPriority,
  type TriageSignals,
} from '@bookleaf/contracts';
import { RefreshCw, Scale, ShieldAlert, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { LeafBadge } from '@/components/brand';
import { ConfidenceMeter, LeafThinking } from '@/components/leaf';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, Tooltip } from '@/components/ui/primitives';
import { isApiError } from '@/lib/api/client';
import { useRetriage, useUpdateTicket } from '@/lib/api/queries';
import { cn } from '@/lib/utils';

const SIGNAL_LABELS: Record<Exclude<keyof TriageSignals, 'monthsWaiting'>, string> = {
  moneyOwed: 'Money owed',
  dataError: 'Data error',
  printDefect: 'Print defect',
  platformUnavailable: 'Not buyable',
  productionDelay: 'Production delay',
  legalThreat: 'Legal / escalation threat',
  manipulationAttempt: 'Manipulation attempt',
};

const SENTIMENT_TONE = {
  calm: 'success',
  concerned: 'info',
  frustrated: 'warning',
  angry: 'danger',
} as const;

const INJECTION_SIGNALS: Record<string, string> = {
  ignore_instructions: 'tries to override instructions',
  ignore_instructions_hinglish: 'tries to override instructions (Hinglish)',
  new_instructions: 'claims to carry new instructions',
  role_override: 'tries to change who the AI is',
  system_prompt_probe: 'asks for hidden instructions',
  role_tag: 'imitates system markup',
  chat_markup: 'imitates model chat markup',
  speaker_label: 'pretends to be the system',
  priority_manipulation: 'tries to force a priority',
  priority_manipulation_hinglish: 'tries to force a priority (Hinglish)',
  jailbreak_terms: 'uses known jailbreak phrasing',
  encoded_payload: 'contains an encoded payload',
  markdown_exfiltration: 'tries to smuggle data out through links',
  reply_hijack: 'tries to dictate the reply',
  schema_spoofing: 'imitates Leaf’s output format',
  hidden_characters: 'contains invisible characters',
};

export function TriageCard({ ticket }: { ticket: AdminTicketDetail }) {
  const { triage } = ticket;
  const update = useUpdateTicket(ticket.id);
  const retriage = useRetriage(ticket.id);
  const working = triage.status === 'pending' || triage.status === 'processing';

  const override = (patch: { category?: TicketCategory; priority?: TicketPriority }) =>
    update.mutate(
      { patch, version: ticket.version },
      {
        onSuccess: () =>
          toast.success('Updated', { description: 'Your call is recorded. Leaf will never overwrite it.' }),
        onError: (error) =>
          toast.error(
            isApiError(error) && error.status === 412
              ? 'Someone else just changed this ticket'
              : "Couldn't update",
            {
              description:
                isApiError(error) && error.status === 412
                  ? 'We refreshed it, please check and try again.'
                  : undefined,
            },
          ),
      },
    );

  const activeSignals = triage.signals
    ? (Object.keys(SIGNAL_LABELS) as Array<keyof typeof SIGNAL_LABELS>).filter((k) => triage.signals?.[k])
    : [];

  return (
    <section className="paper overflow-hidden rounded-2xl" aria-labelledby="triage-title">
      <div className="flex items-center justify-between gap-3 border-b bg-leaf-soft/50 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <LeafBadge label="Leaf's read" />
          <h2 id="triage-title" className="sr-only">
            Leaf triage
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <ConfidenceMeter value={triage.confidence} />
          <Tooltip content="Ask Leaf to read the ticket again">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Re-run triage"
              disabled={working || retriage.isPending || ticket.status === 'closed'}
              onClick={() =>
                retriage.mutate(undefined, { onSuccess: () => toast('Leaf is re-reading the ticket') })
              }
            >
              <RefreshCw className={cn(retriage.isPending && 'animate-spin')} />
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="space-y-5 p-5">
        {working ? (
          <LeafThinking
            steps={['Reading the ticket…', "Checking the author's records…", 'Applying BookLeaf policy…']}
          />
        ) : triage.status === 'failed' && !triage.category ? (
          <p className="text-sm text-muted-foreground">
            Leaf couldn't triage this ticket. Set the category and priority below.
          </p>
        ) : (
          triage.summary && (
            <p className="font-display text-[1.15rem] font-bold leading-snug">{triage.summary}</p>
          )
        )}

        {triage.injection?.flagged && (
          <div className="rounded-xl border border-danger/30 bg-danger-soft/60 p-4">
            <p className="flex items-center gap-2 text-sm font-bold text-danger">
              <ShieldAlert className="size-4" /> Text aimed at an AI was detected and ignored
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/80">
              This ticket{' '}
              {triage.injection.signals.length
                ? triage.injection.signals
                    .map((s) => INJECTION_SIGNALS[s] ?? s.replaceAll('_', ' '))
                    .join(', ')
                : 'contains instructions for an AI'}
              . Leaf treated it as the author's words only, and won't let it raise priority. Read the original
              carefully.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Category
            </p>
            <Select
              aria-label="Category"
              value={triage.category ?? undefined}
              placeholder="Choose…"
              disabled={update.isPending || ticket.status === 'closed'}
              onValueChange={(category) => override({ category })}
              options={TICKET_CATEGORIES.map((c) => ({ value: c, label: TICKET_CATEGORY_LABELS[c] }))}
              className="h-10 text-sm"
            />
            {triage.categorySource === 'admin' &&
              triage.aiCategory &&
              triage.aiCategory !== triage.category && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Leaf suggested {TICKET_CATEGORY_LABELS[triage.aiCategory]}
                </p>
              )}
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Priority
            </p>
            <Select
              aria-label="Priority"
              value={triage.priority ?? undefined}
              placeholder="Choose…"
              disabled={update.isPending || ticket.status === 'closed'}
              onValueChange={(priority) => override({ priority })}
              options={TICKET_PRIORITIES.map((p) => ({ value: p, label: TICKET_PRIORITY_LABELS[p] }))}
              className="h-10 text-sm"
            />
            {triage.prioritySource === 'admin' &&
              triage.aiPriority &&
              triage.aiPriority !== triage.priority && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Leaf suggested {TICKET_PRIORITY_LABELS[triage.aiPriority]}
                </p>
              )}
          </div>
        </div>

        {triage.rationale && (
          <p className="text-[13px] leading-relaxed text-muted-foreground">{triage.rationale}</p>
        )}

        {(activeSignals.length > 0 || triage.sentiment || triage.signals?.monthsWaiting) && (
          <div className="flex flex-wrap gap-1.5">
            {triage.sentiment && (
              <Badge tone={SENTIMENT_TONE[triage.sentiment]} size="sm" dot>
                {triage.sentiment}
              </Badge>
            )}
            {triage.signals?.monthsWaiting ? (
              <Badge tone="warning" size="sm">
                Waiting {triage.signals.monthsWaiting} months
              </Badge>
            ) : null}
            {activeSignals.map((s) => (
              <Badge
                key={s}
                tone={s === 'legalThreat' || s === 'manipulationAttempt' ? 'danger' : 'neutral'}
                size="sm"
              >
                {SIGNAL_LABELS[s]}
              </Badge>
            ))}
            {triage.language && triage.language !== 'en' && (
              <Badge tone="info" size="sm">
                Language: {triage.language}
              </Badge>
            )}
          </div>
        )}

        {triage.policyAdjustments.length > 0 && (
          <div className="space-y-2 rounded-xl bg-muted/60 p-3.5">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              <Scale className="size-3.5" /> BookLeaf policy applied
            </p>
            {triage.policyAdjustments.map((a) => (
              <p key={a.rule} className="text-[13px] leading-snug">
                <span className="font-semibold">
                  {a.from ? `${TICKET_PRIORITY_LABELS[a.from as TicketPriority] ?? a.from} → ` : ''}
                  {TICKET_PRIORITY_LABELS[a.to as TicketPriority] ?? a.to}.
                </span>{' '}
                <span className="text-muted-foreground">{a.reason}</span>
              </p>
            ))}
          </div>
        )}

        {triage.flags.some((f) => f !== 'possible_injection' && f !== 'policy_adjusted') && (
          <div className="flex flex-wrap gap-1.5">
            {triage.flags
              .filter((f) => f !== 'possible_injection' && f !== 'policy_adjusted')
              .map((f) => (
                <Badge key={f} tone={f === 'rule_based' ? 'warning' : 'outline'} size="sm">
                  {f === 'rule_based' && <TriangleAlert />}
                  {AI_FLAG_LABELS[f]}
                </Badge>
              ))}
          </div>
        )}

        {triage.model && (
          <p className="text-[11px] text-muted-foreground">
            {triage.provider} · {triage.model}
          </p>
        )}
      </div>
    </section>
  );
}
