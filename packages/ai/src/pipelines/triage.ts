import type {
  AiFlag,
  InjectionReport,
  PolicyAdjustment,
  Sentiment,
  TicketCategory,
  TicketPriority,
  TriageSignals,
} from '@bookleaf/contracts';
import { applyTriagePolicy, computePayout, type TriageProposal } from '@bookleaf/domain';
import { triageContext } from '../context/fact-sheet';
import { classifyByRules } from '../fallback/rules-classifier';
import { AllProvidersFailedError } from '../gateway/errors';
import type { Usage } from '../gateway/types';
import { createNonce } from '../guards/boundary';
import { HEURISTIC_FLAG_THRESHOLD, MODEL_FLAG_THRESHOLD, scanForInjection } from '../guards/injection';
import {
  buildTriageUserMessage,
  TRIAGE_PROMPT_VERSION,
  TRIAGE_SCHEMA,
  TRIAGE_SYSTEM_PROMPT,
  TriageOutputSchema,
} from '../prompts/triage';
import { extractJsonObject } from '../text/json';
import { redactPii } from '../text/redact';
import { sanitizeUntrusted } from '../text/sanitize';
import type { CallContext, TicketInput } from '../types';
import type { PipelineDeps } from './deps';

export interface TriageOutcome {
  source: 'ai' | 'rules';
  /** Effective classification after BookLeaf policy rules. */
  category: TicketCategory;
  priority: TicketPriority;
  /** What the classifier proposed before policy rules. */
  proposedCategory: TicketCategory;
  proposedPriority: TicketPriority;
  secondaryCategory: TicketCategory | null;
  confidence: number;
  summary: string;
  rationale: string;
  sentiment: Sentiment | null;
  language: string | null;
  signals: TriageSignals;
  flags: AiFlag[];
  policyAdjustments: PolicyAdjustment[];
  injection: InjectionReport;
  provider: string | null;
  model: string | null;
  promptVersion: string;
  usage: Usage | null;
  latencyMs: number;
  /** Why AI was not used (e.g. "rate_limited,timeout"), when the rules fallback ran. */
  aiError: string | null;
}

export interface TriageOptions {
  context?: CallContext;
  signal?: AbortSignal;
  /** Latest author follow-up, when re-triaging an existing ticket. */
  followUp?: string | null;
}

/**
 * Leaf triage: sanitise → detect manipulation (heuristics ∥ Prompt Guard) → classify with a
 * schema-constrained LLM call (rules fallback) → apply BookLeaf policy. Never throws for AI
 * failures; the worst case is a rule-based classification flagged for review.
 */
export async function runTriage(
  deps: PipelineDeps,
  ticket: TicketInput,
  options: TriageOptions = {},
): Promise<TriageOutcome> {
  const today = deps.now();
  const subject = sanitizeUntrusted(ticket.subject, 300);
  const body = sanitizeUntrusted(ticket.description, 6000);
  const followUp = options.followUp ? sanitizeUntrusted(options.followUp, 3000) : null;

  const untrusted = [subject.text, body.text, followUp?.text].filter(Boolean).join('\n\n');
  const hiddenCharacters =
    subject.hiddenCharacters + body.hiddenCharacters + (followUp?.hiddenCharacters ?? 0);
  const heuristic = scanForInjection(untrusted, { hiddenCharacters });

  const redacted = {
    subject: redactPii(subject.text),
    body: redactPii(body.text),
    followUp: followUp ? redactPii(followUp.text) : null,
  };
  const redactionCount = redacted.subject.total + redacted.body.total + (redacted.followUp?.total ?? 0);

  // The guard model runs in parallel with classification; neither waits on the other.
  const guardPromise = deps.gateway.guardScore(
    [redacted.subject.text, redacted.body.text, redacted.followUp?.text].filter(Boolean).join('\n\n'),
    options.context,
  );

  const payoutStatus = ticket.book
    ? computePayout(
        {
          stage: ticket.book.stage,
          publicationDate: ticket.book.publicationDate,
          earnedMinor: ticket.book.earnedMinor,
          paidMinor: ticket.book.paidMinor,
          pendingMinor: ticket.book.pendingMinor,
          lastPayoutDate: ticket.book.lastPayoutDate,
        },
        today,
      ).status
    : null;

  let proposal: TriageProposal;
  let source: 'ai' | 'rules' = 'ai';
  let aiError: string | null = null;
  let meta: {
    summary: string;
    rationale: string;
    secondary: TicketCategory | null;
    language: string | null;
    provider: string | null;
    model: string | null;
    usage: Usage | null;
    latencyMs: number;
  };

  try {
    const run = await deps.gateway.run({
      task: 'triage',
      route: deps.routes.triage,
      request: {
        system: TRIAGE_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: buildTriageUserMessage({
              accountContext: triageContext(ticket, today),
              subject: redacted.subject.text,
              body: redacted.body.text,
              followUp: redacted.followUp?.text ?? null,
              nonce: createNonce(),
            }),
          },
        ],
        schema: TRIAGE_SCHEMA,
        maxOutputTokens: 1200,
        temperature: 0.1,
      },
      parse: (text) => TriageOutputSchema.parse(extractJsonObject(text)),
      timeoutMs: deps.timeouts.triage,
      promptVersion: TRIAGE_PROMPT_VERSION,
      context: options.context,
      signal: options.signal,
    });
    const out = run.value;
    proposal = {
      category: out.category,
      priority: out.priority,
      confidence: out.confidence,
      signals: out.signals,
      sentiment: out.sentiment,
    };
    meta = {
      summary: out.summary,
      rationale: out.rationale,
      secondary: out.secondaryCategory === out.category ? null : out.secondaryCategory,
      language: out.language,
      provider: run.ref.provider,
      model: run.result.model,
      usage: run.result.usage,
      latencyMs: run.latencyMs,
    };
  } catch (error) {
    if (!(error instanceof AllProvidersFailedError)) throw error;
    source = 'rules';
    aiError = error.summary;
    const rules = classifyByRules({
      subject: subject.text,
      description: [body.text, followUp?.text].filter(Boolean).join('\n\n'),
      bookStage: ticket.book?.stage ?? null,
    });
    proposal = {
      category: rules.category,
      priority: rules.priority,
      confidence: rules.confidence,
      signals: rules.signals,
      sentiment: rules.sentiment,
    };
    meta = {
      summary: rules.summary,
      rationale: rules.rationale,
      secondary: null,
      language: null,
      provider: null,
      model: null,
      usage: null,
      latencyMs: 0,
    };
  }

  const modelScore = await guardPromise;
  const flaggedByModel = (modelScore ?? 0) >= MODEL_FLAG_THRESHOLD;
  const flagged =
    heuristic.score >= HEURISTIC_FLAG_THRESHOLD || flaggedByModel || proposal.signals.manipulationAttempt;
  const injection: InjectionReport = {
    flagged,
    score: Math.max(heuristic.score, modelScore ?? 0),
    signals: [
      ...heuristic.signals,
      ...(flaggedByModel ? ['prompt_guard'] : []),
      ...(proposal.signals.manipulationAttempt ? ['llm_detected'] : []),
    ],
    modelScore,
  };

  const decision = applyTriagePolicy(proposal, {
    source,
    injectionFlagged: flagged,
    payoutStatus,
    bookStage: ticket.book?.stage ?? null,
  });
  const flags = new Set(decision.flags);
  if (redactionCount > 0) flags.add('pii_redacted');

  return {
    source,
    category: decision.category,
    priority: decision.priority,
    proposedCategory: proposal.category,
    proposedPriority: proposal.priority,
    secondaryCategory: meta.secondary,
    confidence: proposal.confidence,
    summary: meta.summary,
    rationale: meta.rationale,
    sentiment: proposal.sentiment,
    language: meta.language,
    signals: proposal.signals,
    flags: [...flags],
    policyAdjustments: decision.adjustments,
    injection,
    provider: meta.provider,
    model: meta.model,
    promptVersion: TRIAGE_PROMPT_VERSION,
    usage: meta.usage,
    latencyMs: meta.latencyMs,
    aiError,
  };
}
