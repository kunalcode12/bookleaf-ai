'use client';

import {
  type AdminTicketDetail,
  type AiDraft,
  ESCALATION_TEAM_LABELS,
  LIMITS,
  REFINE_PRESET_LABELS,
  REFINE_PRESETS,
  type RefinePreset,
} from '@bookleaf/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ListChecks, RefreshCw, Siren, Square, WandSparkles } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { LeafBadge } from '@/components/brand';
import { LeafThinking, StreamCaret } from '@/components/leaf';
import { InlineNotice } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/primitives';
import { isApiError } from '@/lib/api/client';
import { keys } from '@/lib/api/queries';
import { streamDraft } from '@/lib/draft-stream';
import { ago } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CheckList, ToneChecks } from './checks';

export function DraftPanel({
  ticket,
  onUse,
}: {
  ticket: AdminTicketDetail;
  onUse: (draft: AiDraft) => void;
}) {
  const client = useQueryClient();
  const [streaming, setStreaming] = useState<{ text: string; label: string } | null>(null);
  const [instruction, setInstruction] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const draft = ticket.draft;
  const closed = ticket.status === 'closed';
  const triaging = ticket.triageStatus === 'pending' || ticket.triageStatus === 'processing';
  const backgroundDrafting =
    !streaming && (ticket.draftStatus === 'processing' || draft?.status === 'generating');

  async function generate(request: { preset?: RefinePreset; instruction?: string }, label: string) {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setStreaming({ text: '', label });
    try {
      const result = await streamDraft(
        ticket.id,
        request,
        {
          onDelta: (text) => setStreaming((s) => (s ? { ...s, text: s.text + text } : s)),
          onReset: () => setStreaming((s) => (s ? { ...s, text: '' } : s)),
        },
        controller.signal,
      );
      client.setQueryData<AdminTicketDetail>(keys.ticket(ticket.id), (old) =>
        old ? { ...old, draft: result } : old,
      );
      void client.invalidateQueries({ queryKey: ['admin', 'ticket'] });
      setInstruction('');
    } catch (error) {
      if (controller.signal.aborted) return;
      toast.error('Leaf could not finish the draft', {
        description: isApiError(error) ? error.message : 'You can still write the reply yourself.',
      });
    } finally {
      if (abort.current === controller) {
        abort.current = null;
        setStreaming(null);
      }
    }
  }

  const refine = (event: FormEvent) => {
    event.preventDefault();
    const text = instruction.trim();
    if (text) void generate({ instruction: text }, 'Following your instruction…');
  };

  return (
    <section className="paper overflow-hidden rounded-2xl" aria-labelledby="draft-title">
      <div className="flex items-center justify-between gap-3 border-b bg-leaf-soft/50 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <LeafBadge label="Draft reply" />
          <h2 id="draft-title" className="sr-only">
            Leaf draft
          </h2>
          {draft && !streaming && (
            <span className="text-[11px] font-semibold text-muted-foreground">
              v{draft.version}
              {draft.preset ? ` · ${REFINE_PRESET_LABELS[draft.preset].toLowerCase()}` : ''} ·{' '}
              {ago(draft.createdAt)}
            </span>
          )}
        </div>
        {streaming ? (
          <Button variant="ghost" size="sm" onClick={() => abort.current?.abort()}>
            <Square /> Stop
          </Button>
        ) : (
          <Tooltip content="Write a fresh draft from the latest conversation">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Regenerate draft"
              disabled={closed || triaging}
              onClick={() => void generate({}, 'Writing a fresh draft…')}
            >
              <RefreshCw />
            </Button>
          </Tooltip>
        )}
      </div>

      <div className="space-y-4 p-5">
        {streaming ? (
          <div className="space-y-3">
            <LeafThinking
              steps={[streaming.label, 'Checking facts against records…', 'Matching BookLeaf’s tone…']}
            />
            {streaming.text && (
              <div className="max-h-80 overflow-y-auto whitespace-pre-line rounded-xl bg-background-deep/50 p-4 text-[14px] leading-relaxed scrollbar-thin">
                {streaming.text}
                <StreamCaret />
              </div>
            )}
          </div>
        ) : triaging ? (
          <LeafThinking steps={['Reading the ticket first…', 'A draft follows triage…']} />
        ) : backgroundDrafting ? (
          <LeafThinking
            steps={['Drafting a reply…', 'Pulling the author’s records…', 'Checking BookLeaf policy…']}
          />
        ) : !draft || draft.status === 'failed' ? (
          <div className="space-y-3">
            {draft?.status === 'failed' && (
              <InlineNotice tone="warning" title="The last draft didn't finish">
                Leaf's providers were unavailable. Try again, or write the reply yourself.
              </InlineNotice>
            )}
            <Button
              variant="leaf"
              className="w-full"
              disabled={closed}
              onClick={() => void generate({}, 'Writing a draft…')}
            >
              <WandSparkles /> Draft a reply with Leaf
            </Button>
          </div>
        ) : (
          <>
            {draft.isStale && (
              <InlineNotice
                tone="warning"
                title="The conversation moved on"
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void generate({}, 'Catching up on the thread…')}
                  >
                    Update
                  </Button>
                }
              >
                This draft was written before the latest messages.
              </InlineNotice>
            )}
            {draft.origin === 'scaffold' && (
              <InlineNotice tone="info" title="Outline, not a finished reply">
                AI was unavailable, so this is a policy outline. Fill the [[bracketed]] parts before sending.
              </InlineNotice>
            )}
            <div className="max-h-80 overflow-y-auto whitespace-pre-line rounded-xl bg-background-deep/50 p-4 text-[14px] leading-relaxed scrollbar-thin">
              {draft.body}
            </div>

            {draft.checklist && <ToneChecks checklist={draft.checklist} />}
            <CheckList checks={draft.checks} limit={6} />

            {draft.policiesUsed.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Grounded in
                </span>
                {draft.policiesUsed.map((p) => (
                  <Badge key={p.slug} tone="leaf" size="sm">
                    {p.title}
                  </Badge>
                ))}
              </div>
            )}

            {draft.needsEscalation && (
              <div className="rounded-xl border border-accent/30 bg-accent-soft/50 p-3.5">
                <p className="flex items-center gap-1.5 text-[13px] font-bold text-accent-ink">
                  <Siren className="size-4" /> Escalate to{' '}
                  {draft.escalationTeam ? ESCALATION_TEAM_LABELS[draft.escalationTeam] : 'a specialist team'}
                </p>
                {draft.internalNextSteps.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {draft.internalNextSteps.map((step) => (
                      <li key={step} className="flex gap-2 text-[13px] leading-snug text-foreground/85">
                        <ListChecks className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> {step}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <Button variant="leaf" className="w-full" disabled={closed} onClick={() => onUse(draft)}>
              <ArrowDownToLine /> Use this draft
            </Button>

            {!closed && (
              <div className="space-y-2 border-t pt-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Refine
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {REFINE_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() =>
                        void generate({ preset }, `Making it ${REFINE_PRESET_LABELS[preset].toLowerCase()}…`)
                      }
                      className="rounded-full border bg-card px-3 py-1 text-xs font-semibold transition hover:border-leaf/40 hover:bg-leaf-soft hover:text-leaf-ink"
                    >
                      {REFINE_PRESET_LABELS[preset]}
                    </button>
                  ))}
                </div>
                <form onSubmit={refine} className="flex gap-2">
                  <input
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    maxLength={LIMITS.refineInstruction.max}
                    placeholder="e.g. mention the re-sync is already triggered"
                    className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-card px-3 text-[13px] outline-none focus:border-foreground/40"
                    aria-label="Instruction for Leaf"
                  />
                  <Button type="submit" size="sm" variant="soft" disabled={!instruction.trim()}>
                    Refine
                  </Button>
                </form>
              </div>
            )}

            {draft.versions.length > 1 && (
              <p className={cn('text-[11px] text-muted-foreground')}>
                {draft.versions.length} versions ·{' '}
                {draft.model ? `${draft.provider} · ${draft.model}` : 'policy outline'}
                {draft.latencyMs ? ` · ${(draft.latencyMs / 1000).toFixed(1)}s` : ''}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
