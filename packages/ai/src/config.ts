import { AI_PROVIDER_IDS } from '@bookleaf/contracts';
import type { RateLimitSpec } from './gateway/rate-limiter';
import type { ModelRef, ProviderId, ReasoningLevel } from './gateway/types';

export type LlmTask = 'triage' | 'draft' | 'assist' | 'summarize';

/**
 * Model routes per task, cheapest-sufficient first. Classification uses Flash-Lite models with
 * minimal thinking (small, fast, ~1k tokens per call); drafting uses the stronger Flash model.
 * Each Gemini model has its own free quota, so a second Gemini model precedes the cross-provider
 * fallback; Groq runs on independent infrastructure; OpenRouter's free router is the last resort.
 */
export const DEFAULT_ROUTES: Record<LlmTask, ModelRef[]> = {
  triage: [
    { provider: 'gemini', model: 'gemini-3.5-flash-lite', reasoning: 'minimal' },
    { provider: 'gemini', model: 'gemini-3.1-flash-lite', reasoning: 'minimal' },
    { provider: 'groq', model: 'openai/gpt-oss-20b', reasoning: 'low' },
    { provider: 'openrouter', model: 'openrouter/free' },
  ],
  draft: [
    { provider: 'gemini', model: 'gemini-3.8-flash', reasoning: 'low' },
    { provider: 'gemini', model: 'gemini-3.6-flash', reasoning: 'low' },
    { provider: 'groq', model: 'openai/gpt-oss-120b', reasoning: 'low' },
    { provider: 'openrouter', model: 'openrouter/free' },
  ],
  assist: [
    { provider: 'gemini', model: 'gemini-3.5-flash-lite', reasoning: 'low' },
    { provider: 'groq', model: 'openai/gpt-oss-20b', reasoning: 'low' },
    { provider: 'openrouter', model: 'openrouter/free' },
  ],
  summarize: [
    { provider: 'gemini', model: 'gemini-3.1-flash-lite', reasoning: 'minimal' },
    { provider: 'groq', model: 'openai/gpt-oss-20b', reasoning: 'low' },
  ],
};

export const DEFAULT_EMBEDDING: Pick<ModelRef, 'provider' | 'model'> = {
  provider: 'gemini',
  model: 'gemini-embedding-001',
};

export const DEFAULT_GUARD: Pick<ModelRef, 'provider' | 'model'> = {
  provider: 'groq',
  model: 'meta-llama/llama-prompt-guard-2-86m',
};

/**
 * Conservative client-side limits under each provider's free tier. Override with LEAF_RATE_LIMITS
 * once the project's actual quotas (shown in AI Studio / the Groq console) are known.
 */
export const DEFAULT_LIMITS: Record<string, RateLimitSpec> = {
  'gemini:gemini-3.8-flash': { rpm: 8, rpd: 240 },
  'gemini:gemini-3.6-flash': { rpm: 8, rpd: 240 },
  'gemini:gemini-3.5-flash-lite': { rpm: 12, rpd: 900 },
  'gemini:gemini-3.1-flash-lite': { rpm: 12, rpd: 900 },
  'gemini:gemini-embedding-001': { rpm: 80, rpd: 900 },
  'groq:openai/gpt-oss-120b': { rpm: 28, tpm: 7500, rpd: 950 },
  'groq:openai/gpt-oss-20b': { rpm: 28, tpm: 7500, rpd: 950 },
  'groq:meta-llama/llama-prompt-guard-2-86m': { rpm: 28, rpd: 14_000 },
  'openrouter:openrouter/free': { rpm: 18, rpd: 45 },
};

export const DEFAULT_TIMEOUTS_MS: Record<LlmTask, number> = {
  triage: 20_000,
  draft: 45_000,
  assist: 20_000,
  summarize: 20_000,
};

const REASONING_LEVELS: readonly ReasoningLevel[] = ['minimal', 'low', 'medium', 'high'];

function parseRef(entry: string): ModelRef {
  const [target, reasoning] = entry.trim().split('@');
  const separator = target!.indexOf(':');
  if (separator <= 0)
    throw new Error(`Invalid model reference "${entry}" (expected provider:model[@reasoning])`);
  const provider = target!.slice(0, separator) as ProviderId;
  const model = target!.slice(separator + 1);
  if (!AI_PROVIDER_IDS.includes(provider)) throw new Error(`Unknown AI provider "${provider}" in "${entry}"`);
  if (!model) throw new Error(`Missing model in "${entry}"`);
  if (reasoning && !REASONING_LEVELS.includes(reasoning as ReasoningLevel)) {
    throw new Error(`Invalid reasoning level "${reasoning}" in "${entry}"`);
  }
  return reasoning ? { provider, model, reasoning: reasoning as ReasoningLevel } : { provider, model };
}

/** "gemini:gemini-3.8-flash@low,groq:openai/gpt-oss-120b@low" → ordered route. */
export function parseRoute(input: string | undefined | null): ModelRef[] | null {
  if (!input?.trim()) return null;
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseRef);
}

/** "gemini:gemini-embedding-001" → ref; "off" / "none" → null (feature disabled). */
export function parseModelSetting(
  input: string | undefined | null,
): Pick<ModelRef, 'provider' | 'model'> | null | undefined {
  if (input === undefined || input === null || input.trim() === '') return undefined;
  if (/^(off|none|disabled)$/i.test(input.trim())) return null;
  const { provider, model } = parseRef(input);
  return { provider, model };
}

export const describeRef = (ref: ModelRef) =>
  `${ref.provider}:${ref.model}${ref.reasoning ? `@${ref.reasoning}` : ''}`;
