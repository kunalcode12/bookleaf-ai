import type { AiProviderId, AiTask } from '@bookleaf/contracts';

export type ProviderId = AiProviderId;

/** Thinking/reasoning depth; mapped to each provider's own parameter. */
export type ReasoningLevel = 'minimal' | 'low' | 'medium' | 'high';

export interface ModelRef {
  provider: ProviderId;
  model: string;
  reasoning?: ReasoningLevel;
}

export const modelKey = (ref: Pick<ModelRef, 'provider' | 'model'>) => `${ref.provider}:${ref.model}`;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StructuredSchema {
  name: string;
  /** JSON Schema authored in the strict subset both Gemini and OpenAI-style providers accept. */
  jsonSchema: Record<string, unknown>;
}

export interface GenerateRequest {
  system: string;
  messages: ChatMessage[];
  schema?: StructuredSchema;
  maxOutputTokens: number;
  temperature?: number;
}

export interface Usage {
  inputTokens: number;
  /** Visible output only; thinking is counted separately in `reasoningTokens`. */
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
}

export const ZERO_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cachedInputTokens: 0,
};

export interface GenerateResult {
  text: string;
  usage: Usage;
  finishReason: 'stop' | 'length' | 'safety' | 'other';
  /** Model id the provider reports (routers like openrouter/free resolve to a concrete model). */
  model: string;
}

export type StreamChunk = { type: 'text'; text: string } | { type: 'done'; result: GenerateResult };

export interface LlmProvider {
  readonly id: ProviderId;
  generate(ref: ModelRef, request: GenerateRequest, signal: AbortSignal): Promise<GenerateResult>;
  /** Present only when the provider can stream; may be unavailable for structured output. */
  stream?(ref: ModelRef, request: GenerateRequest, signal: AbortSignal): AsyncGenerator<StreamChunk>;
  canStream(ref: ModelRef, request: GenerateRequest): boolean;
}

export interface EmbeddingProvider {
  readonly id: ProviderId;
  embed(
    model: string,
    texts: string[],
    kind: 'document' | 'query',
    signal: AbortSignal,
  ): Promise<{ vectors: number[][]; inputTokens: number }>;
}

export interface GuardProvider {
  readonly id: ProviderId;
  /** Probability (0–1) that `text` is a prompt attack, or null if the model gave no usable score. */
  score(
    model: string,
    text: string,
    signal: AbortSignal,
  ): Promise<{ score: number | null; inputTokens: number }>;
}

/** One provider call, successful or not — persisted to ai_runs by the API. */
export interface AiCallEvent {
  task: AiTask;
  provider: string;
  model: string;
  promptVersion: string | null;
  outcome: 'success' | 'error' | 'fallback' | 'skipped';
  errorCode: string | null;
  errorMessage: string | null;
  attempt: number;
  usage: Usage;
  latencyMs: number;
  estimatedCostUsd: number;
  ticketId: string | null;
  draftId: string | null;
  metadata?: Record<string, unknown>;
}

export type TelemetrySink = (event: AiCallEvent) => void;
