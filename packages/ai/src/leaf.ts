import type { AiHealth } from '@bookleaf/contracts';
import {
  DEFAULT_EMBEDDING,
  DEFAULT_GUARD,
  DEFAULT_LIMITS,
  DEFAULT_ROUTES,
  DEFAULT_TIMEOUTS_MS,
  describeRef,
  type LlmTask,
} from './config';
import { type GatewayHealth, LlmGateway } from './gateway/gateway';
import type { FetchLike } from './gateway/http';
import { GeminiProvider } from './gateway/providers/gemini';
import { OpenAICompatibleProvider } from './gateway/providers/openai-compatible';
import type { RateLimitSpec } from './gateway/rate-limiter';
import type {
  EmbeddingProvider,
  GuardProvider,
  LlmProvider,
  ModelRef,
  ProviderId,
  TelemetrySink,
} from './gateway/types';
import { type AssistInput, type AssistOutcome, runAssist } from './pipelines/assist';
import type { PipelineDeps } from './pipelines/deps';
import { type DraftInput, type DraftOptions, type DraftOutcome, runDraft } from './pipelines/draft';
import { runSummary } from './pipelines/summarize';
import { runTriage, type TriageOptions, type TriageOutcome } from './pipelines/triage';
import type { CallContext, TicketInput } from './types';

export interface LeafConfig {
  geminiApiKey?: string | null;
  groqApiKey?: string | null;
  openRouterApiKey?: string | null;
  /** Public URL sent to OpenRouter for attribution. */
  appUrl?: string;
  routes?: Partial<Record<LlmTask, ModelRef[]>>;
  /** `null` disables embeddings; undefined uses the default model. */
  embedding?: Pick<ModelRef, 'provider' | 'model'> | null;
  /** `null` disables the Prompt Guard classifier; undefined uses the default model. */
  guard?: Pick<ModelRef, 'provider' | 'model'> | null;
  limits?: Record<string, RateLimitSpec>;
  timeouts?: Partial<Record<LlmTask, number>>;
  allowedLinkDomains?: string[];
  telemetry?: TelemetrySink;
  onHealthChange?: (health: GatewayHealth) => void;
  now?: () => Date;
  fetch?: FetchLike;
  /** Test seams: inject providers instead of building them from API keys. */
  providers?: Partial<Record<ProviderId, LlmProvider>>;
  embeddingProvider?: EmbeddingProvider;
  guardProvider?: GuardProvider;
}

export interface Leaf {
  triage(ticket: TicketInput, options?: TriageOptions): Promise<TriageOutcome>;
  draft(input: DraftInput, options?: DraftOptions): Promise<DraftOutcome>;
  assist(
    input: AssistInput,
    options?: { context?: CallContext; signal?: AbortSignal },
  ): Promise<AssistOutcome>;
  summarize(
    ticket: TicketInput,
    options?: { context?: CallContext; signal?: AbortSignal },
  ): Promise<{ summary: string; upTo: number } | null>;
  embed(texts: string[], kind: 'document' | 'query', context?: CallContext): Promise<number[][] | null>;
  health(): AiHealth;
  readonly configured: { llm: boolean; embeddings: boolean; guard: boolean };
  readonly embeddingModel: string | null;
}

/**
 * Builds Leaf from configuration: provider adapters for whichever API keys exist, one gateway
 * (routing, failover, circuit breakers, rate limits, telemetry) and the four pipelines. With no
 * keys at all Leaf still works — triage falls back to rules and drafts to policy outlines.
 */
export function createLeaf(config: LeafConfig = {}): Leaf {
  const fetchImpl = config.fetch;
  const gemini = config.geminiApiKey ? new GeminiProvider(config.geminiApiKey, { fetch: fetchImpl }) : null;
  const groq = config.groqApiKey
    ? new OpenAICompatibleProvider({
        id: 'groq',
        apiKey: config.groqApiKey,
        baseUrl: 'https://api.groq.com/openai/v1',
        maxTokensField: 'max_completion_tokens',
        streamsStructuredOutput: false,
        fetch: fetchImpl,
      })
    : null;
  const openrouter = config.openRouterApiKey
    ? new OpenAICompatibleProvider({
        id: 'openrouter',
        apiKey: config.openRouterApiKey,
        baseUrl: 'https://openrouter.ai/api/v1',
        headers: {
          'HTTP-Referer': config.appUrl ?? 'https://bookleaf.support',
          'X-Title': 'BookLeaf Support',
        },
        maxTokensField: 'max_tokens',
        streamsStructuredOutput: false,
        fetch: fetchImpl,
      })
    : null;

  const providers: Partial<Record<ProviderId, LlmProvider>> = config.providers ?? {
    ...(gemini ? { gemini } : {}),
    ...(groq ? { groq } : {}),
    ...(openrouter ? { openrouter } : {}),
  };

  const embeddingRef = config.embedding === undefined ? DEFAULT_EMBEDDING : config.embedding;
  const embeddingProvider =
    config.embeddingProvider ?? (embeddingRef?.provider === 'gemini' ? (gemini ?? undefined) : undefined);
  const guardRef = config.guard === undefined ? DEFAULT_GUARD : config.guard;
  const guardProvider =
    config.guardProvider ??
    (guardRef?.provider === 'groq'
      ? (groq ?? undefined)
      : guardRef?.provider === 'openrouter'
        ? (openrouter ?? undefined)
        : undefined);

  const gateway = new LlmGateway({
    providers,
    embedding:
      embeddingRef && embeddingProvider ? { provider: embeddingProvider, model: embeddingRef.model } : null,
    guard: guardRef && guardProvider ? { provider: guardProvider, model: guardRef.model } : null,
    limits: { ...DEFAULT_LIMITS, ...config.limits },
    telemetry: config.telemetry,
    onHealthChange: config.onHealthChange,
  });

  const routes: Record<LlmTask, ModelRef[]> = { ...DEFAULT_ROUTES, ...config.routes };
  const deps: PipelineDeps = {
    gateway,
    routes,
    timeouts: { ...DEFAULT_TIMEOUTS_MS, ...config.timeouts },
    now: config.now ?? (() => new Date()),
    allowedLinkDomains: config.allowedLinkDomains ?? [],
  };

  const configured = { llm: gateway.hasLlm, embeddings: gateway.hasEmbeddings, guard: gateway.hasGuard };

  return {
    triage: (ticket, options) => runTriage(deps, ticket, options),
    draft: (input, options) => runDraft(deps, input, options),
    assist: (input, options) => runAssist(deps, input, options),
    summarize: (ticket, options) => runSummary(deps, ticket, options),
    embed: (texts, kind, context) => gateway.embed(texts, kind, context),
    configured,
    embeddingModel: configured.embeddings && embeddingRef ? embeddingRef.model : null,
    health(): AiHealth {
      const snapshot = gateway.health();
      const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
      const message =
        snapshot.status === 'operational'
          ? 'Leaf is running normally.'
          : snapshot.status === 'degraded'
            ? 'Some AI providers are unavailable. Leaf is using fallbacks — responses may be slower.'
            : configured.llm
              ? 'All AI providers are currently unavailable. Tickets are still saved; triage uses rules and drafts use policy outlines.'
              : 'No AI provider keys are configured. Triage uses rules and drafts use policy outlines.';
      return {
        status: snapshot.status,
        message,
        providers: snapshot.providers.map((p) => ({
          id: p.id,
          configured: p.configured,
          circuit: p.circuit,
          lastError: p.lastError,
          lastSuccessAt: iso(p.lastSuccessAt),
          lastFailureAt: iso(p.lastFailureAt),
        })),
        routes: {
          triage: routes.triage.map(describeRef),
          draft: routes.draft.map(describeRef),
          assist: routes.assist.map(describeRef),
          summarize: routes.summarize.map(describeRef),
          embed: embeddingRef ? [`${embeddingRef.provider}:${embeddingRef.model}`] : [],
          guard: guardRef ? [`${guardRef.provider}:${guardRef.model}`] : [],
          judge: [],
        },
        guard: { configured: configured.guard, model: guardRef?.model ?? null },
        embeddings: { configured: configured.embeddings, model: embeddingRef?.model ?? null },
      };
    },
  };
}
