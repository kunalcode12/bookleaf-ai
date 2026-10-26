import type { Usage } from './types';

/**
 * Reference list prices (USD per 1M tokens) used to estimate what traffic *would* cost on paid
 * tiers. BookLeaf runs on free tiers today (actual spend $0); the estimate shows the production
 * bill and makes the token savings from context budgeting visible. Update from the providers'
 * pricing pages when promoting to a paid tier.
 */
export const REFERENCE_PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  'gemini:gemini-3.8-flash': { input: 0.75, output: 3.75 },
  'gemini:gemini-3.6-flash': { input: 0.75, output: 3.75 },
  'gemini:gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  'gemini:gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
  'gemini:gemini-embedding-001': { input: 0.15, output: 0 },
  'groq:openai/gpt-oss-120b': { input: 0.15, output: 0.6 },
  'groq:openai/gpt-oss-20b': { input: 0.075, output: 0.3 },
  'groq:meta-llama/llama-prompt-guard-2-86m': { input: 0.04, output: 0.04 },
  'openrouter:openrouter/free': { input: 0, output: 0 },
  // Paid-tier comparison point named in the docs (Anthropic Claude Haiku 5.5).
  'anthropic:claude-haiku-5-5': { input: 0.1, output: 0.5 },
};

export function estimateCostUsd(key: string, usage: Usage): number {
  const price = REFERENCE_PRICES_PER_MTOK[key];
  if (!price) return 0;
  const output = usage.outputTokens + usage.reasoningTokens;
  return (usage.inputTokens * price.input + output * price.output) / 1_000_000;
}
