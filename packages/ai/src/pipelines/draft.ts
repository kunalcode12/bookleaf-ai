import type {
  DraftCheck,
  EscalationTeam,
  GroundingIndex,
  RefinePreset,
  ToneChecklist,
} from '@bookleaf/contracts';
import { KNOWLEDGE_BASE, TONE_GUIDE_SLUG } from '@bookleaf/domain';
import { buildFactSheet } from '../context/fact-sheet';
import { windowThread } from '../context/history';
import { selectExamples, selectKnowledge } from '../context/knowledge';
import { scaffoldReply } from '../fallback/scaffold';
import { AllProvidersFailedError } from '../gateway/errors';
import type { RunResult } from '../gateway/gateway';
import type { Usage } from '../gateway/types';
import { containsCanary, createCanary, createNonce } from '../guards/boundary';
import { buildGroundingIndex } from '../output/grounding';
import { reviewDraft } from '../output/review';
import {
  buildDraftSystemPrompt,
  buildDraftUserMessage,
  cleanupReply,
  DRAFT_PROMPT_VERSION,
  DRAFT_SCHEMA,
  type DraftOutput,
  DraftOutputSchema,
  signatureFor,
} from '../prompts/draft';
import { DEFAULT_TONE_GUIDE } from '../prompts/shared';
import { extractJsonObject, StreamingStringField } from '../text/json';
import { estimateTokens } from '../text/tokens';
import type {
  AgentSignature,
  CallContext,
  KnowledgeExampleInput,
  KnowledgeSectionInput,
  TicketInput,
} from '../types';
import type { PipelineDeps } from './deps';

export interface DraftInput {
  /** Ticket with its effective category/priority already set. */
  ticket: TicketInput;
  knowledge: KnowledgeSectionInput[];
  examples: KnowledgeExampleInput[];
  agent: AgentSignature | null;
  preset?: RefinePreset | null;
  instruction?: string | null;
  /** Draft text to revise (refinements build on the current version). */
  baseDraft?: string | null;
  /** Embedding of the ticket text, for semantic policy/example selection. */
  queryEmbedding?: number[] | null;
}

export interface DraftOutcome {
  origin: 'ai' | 'scaffold';
  body: string;
  factsUsed: string[];
  policiesUsed: Array<{ slug: string; title: string }>;
  needsEscalation: boolean;
  escalationTeam: EscalationTeam | null;
  internalNextSteps: string[];
  checks: DraftCheck[];
  checklist: ToneChecklist;
  grounding: GroundingIndex;
  provider: string | null;
  model: string | null;
  promptVersion: string;
  usage: Usage | null;
  latencyMs: number;
  /** Estimated prompt tokens actually sent vs. the naive "send everything" prompt. */
  inputTokensEstimate: number;
  baselineInputTokens: number;
  aiError: string | null;
}

export interface DraftOptions {
  context?: CallContext;
  signal?: AbortSignal;
  /** Stream the reply text as it is generated (only effective for streaming-capable models). */
  onDelta?: (text: string) => void;
  /** A streaming model failed mid-way; the UI should clear what it has shown so far. */
  onReset?: () => void;
}

/**
 * Leaf drafting: assemble a token-budgeted context (fact sheet for this book only, the policy
 * sections for this category, 1–2 calibration examples, a windowed thread), generate a
 * structured reply, then review it deterministically. Falls back to a policy-based outline.
 */
export async function runDraft(
  deps: PipelineDeps,
  input: DraftInput,
  options: DraftOptions = {},
): Promise<DraftOutcome> {
  const today = deps.now();
  const { ticket } = input;
  const category = ticket.category ?? 'general_inquiry';

  const factSheet = buildFactSheet(ticket, today);
  const thread = windowThread(ticket);
  const toneSection = input.knowledge.find((s) => s.slug === TONE_GUIDE_SLUG);
  const selection = selectKnowledge({
    sections: input.knowledge,
    category,
    secondaryCategory: null,
    queryEmbedding: input.queryEmbedding ?? null,
    excludeSlugs: [TONE_GUIDE_SLUG],
  });
  const examples = selectExamples(input.examples, category, input.queryEmbedding ?? null);
  const signature = signatureFor(input.agent);
  const canary = createCanary();

  const system = buildDraftSystemPrompt({
    toneGuide: toneSection?.body ?? DEFAULT_TONE_GUIDE,
    policies: selection.sections,
    examples,
    canary,
  });
  const user = buildDraftUserMessage({
    facts: factSheet.rendered,
    category,
    priority: ticket.priority,
    status: ticket.status,
    thread: thread.text,
    nonce: createNonce(),
    signature,
    preset: input.preset,
    instruction: input.instruction,
    baseDraft: input.baseDraft,
  });

  // Every policy BookLeaf publishes may be quoted, not only the sections selected for this prompt.
  const policyTexts = (input.knowledge.length > 0 ? input.knowledge : KNOWLEDGE_BASE).map((s) => ({
    slug: s.slug,
    body: s.body,
  }));
  const grounding = buildGroundingIndex({
    facts: factSheet.facts,
    policies: policyTexts,
    authorTexts: thread.authorTexts,
  });

  const inputTokensEstimate = estimateTokens(system) + estimateTokens(user);
  // The naive prompt: the whole knowledge base and the full conversation, every time.
  const fullFacts =
    ticket.portfolio.length > 1 ? estimateTokens(factSheet.rendered) * ticket.portfolio.length : 0;
  const baselineInputTokens =
    inputTokensEstimate -
    selection.tokens -
    thread.tokens +
    selection.baselineTokens +
    thread.baselineTokens +
    fullFacts;

  const parse = (text: string): DraftOutput => {
    const output = DraftOutputSchema.parse(extractJsonObject(text));
    if (containsCanary(output.reply, canary))
      throw new Error('Reply contains the confidential prompt canary');
    return output;
  };

  const request = {
    system,
    messages: [{ role: 'user' as const, content: user }],
    schema: DRAFT_SCHEMA,
    maxOutputTokens: 2400,
    temperature: 0.4,
  };
  const runOptions = {
    task: 'draft' as const,
    route: deps.routes.draft,
    request,
    parse,
    timeoutMs: deps.timeouts.draft,
    promptVersion: DRAFT_PROMPT_VERSION,
    context: options.context,
    signal: options.signal,
    metadata: { baselineInputTokens, inputTokensEstimate, policies: selection.sections.map((s) => s.slug) },
  };

  let run: RunResult<DraftOutput> | null = null;
  let aiError: string | null = null;
  try {
    if (options.onDelta) {
      let field = new StreamingStringField('reply');
      for await (const event of deps.gateway.runStream(runOptions)) {
        if (event.type === 'delta') {
          const text = field.push(event.text);
          if (text) options.onDelta(text);
        } else if (event.type === 'reset') {
          field = new StreamingStringField('reply');
          options.onReset?.();
        } else {
          run = event.run;
        }
      }
    } else {
      run = await deps.gateway.run(runOptions);
    }
  } catch (error) {
    if (!(error instanceof AllProvidersFailedError)) throw error;
    aiError = error.summary;
  }

  if (!run) {
    const body = scaffoldReply({ ticket, category, signature, today });
    const review = reviewDraft(body, {
      grounding,
      needsEscalation: false,
      bookTitle: ticket.book?.title ?? null,
      allowedLinkDomains: deps.allowedLinkDomains,
    });
    return {
      origin: 'scaffold',
      body,
      factsUsed: [],
      policiesUsed: selection.sections.map((s) => ({ slug: s.slug, title: s.title })),
      needsEscalation: false,
      escalationTeam: null,
      internalNextSteps: [],
      checks: review.checks,
      checklist: review.checklist,
      grounding,
      provider: null,
      model: null,
      promptVersion: DRAFT_PROMPT_VERSION,
      usage: null,
      latencyMs: 0,
      inputTokensEstimate: 0,
      baselineInputTokens,
      aiError: aiError ?? 'not_configured',
    };
  }

  const output = run.value;
  const body = cleanupReply(output.reply);
  const review = reviewDraft(body, {
    grounding,
    needsEscalation: output.needsEscalation,
    bookTitle: ticket.book?.title ?? null,
    allowedLinkDomains: deps.allowedLinkDomains,
  });
  const factIds = new Set(factSheet.facts.map((f) => f.id));
  const knownPolicies = new Map(input.knowledge.map((s) => [s.slug, s.title]));

  return {
    origin: 'ai',
    body,
    factsUsed: [...new Set(output.factsUsed.filter((id) => factIds.has(id)))],
    policiesUsed: [...new Set(output.policiesUsed)]
      .filter((slug) => knownPolicies.has(slug))
      .map((slug) => ({ slug, title: knownPolicies.get(slug)! })),
    needsEscalation: output.needsEscalation,
    escalationTeam: output.needsEscalation ? output.escalationTeam : null,
    internalNextSteps: output.internalNextSteps,
    checks: review.checks,
    checklist: review.checklist,
    grounding,
    provider: run.ref.provider,
    model: run.result.model,
    promptVersion: DRAFT_PROMPT_VERSION,
    usage: run.result.usage,
    latencyMs: run.latencyMs,
    inputTokensEstimate,
    baselineInputTokens,
    aiError: run.failures.length > 0 ? run.failures.map((f) => f.kind).join(',') : null,
  };
}
