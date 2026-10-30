/**
 * Client-side rate limiting per provider/model, sized to the free-tier quotas. Staying under the
 * provider's limits avoids 429 storms entirely: when a model is at capacity the gateway moves to
 * the next model in the route immediately instead of waiting to be rejected.
 */
export interface RateLimitSpec {
  /** Requests per minute. */
  rpm?: number;
  /**
   * Tokens per minute. A request holds its estimate (input + max output) while in flight, then
   * the usage the provider reported — providers count what was used, not the output budget.
   */
  tpm?: number;
  /** Requests per rolling 24 hours. */
  rpd?: number;
}

interface Window {
  timestamps: number[];
  tokens: Array<{ at: number; tokens: number }>;
  daily: number[];
  blockedUntil: number;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly specs: Record<string, RateLimitSpec>,
    private readonly now: () => number = Date.now,
  ) {}

  private window(key: string): Window {
    let w = this.windows.get(key);
    if (!w) {
      w = { timestamps: [], tokens: [], daily: [], blockedUntil: 0 };
      this.windows.set(key, w);
    }
    return w;
  }

  /**
   * Reserves capacity for one request. Returns 0 when it may go now, or the milliseconds until
   * capacity frees up (the caller decides whether to wait or try another model).
   */
  reserve(key: string, estimatedTokens: number): number {
    const spec = this.specs[key];
    const now = this.now();
    const w = this.window(key);
    if (w.blockedUntil > now) return w.blockedUntil - now;
    if (!spec) return 0;

    w.timestamps = w.timestamps.filter((t) => now - t < MINUTE);
    w.tokens = w.tokens.filter((t) => now - t.at < MINUTE);
    w.daily = w.daily.filter((t) => now - t < DAY);

    if (spec.rpd !== undefined && w.daily.length >= spec.rpd) return w.daily[0]! + DAY - now;
    if (spec.rpm !== undefined && w.timestamps.length >= spec.rpm) return w.timestamps[0]! + MINUTE - now;
    if (spec.tpm !== undefined) {
      const used = w.tokens.reduce((sum, t) => sum + t.tokens, 0);
      if (used + estimatedTokens > spec.tpm && w.tokens.length > 0) return w.tokens[0]!.at + MINUTE - now;
    }

    w.timestamps.push(now);
    w.tokens.push({ at: now, tokens: estimatedTokens });
    w.daily.push(now);
    return 0;
  }

  /**
   * Replaces a finished request's reserved estimate with the tokens it actually used, freeing the
   * difference for the rest of the minute (a draft reserves its whole output budget but typically
   * writes a third of it).
   */
  settle(key: string, estimatedTokens: number, actualTokens: number): void {
    const tokens = this.windows.get(key)?.tokens;
    if (!tokens || actualTokens <= 0) return;
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      if (tokens[i]!.tokens === estimatedTokens) {
        tokens[i]!.tokens = actualTokens;
        return;
      }
    }
  }

  /** The provider told us to back off (429 + Retry-After). */
  block(key: string, ms: number): void {
    const w = this.window(key);
    w.blockedUntil = Math.max(w.blockedUntil, this.now() + ms);
  }
}

/** Parses "gemini:gemini-3.8-flash=rpm:10,rpd:250;groq:openai/gpt-oss-120b=rpm:28,tpm:7500". */
export function parseRateLimits(input: string | undefined): Record<string, RateLimitSpec> {
  const out: Record<string, RateLimitSpec> = {};
  if (!input) return out;
  for (const entry of input.split(';')) {
    const [key, spec] = entry.split('=').map((s) => s?.trim());
    if (!key || !spec) continue;
    const parsed: RateLimitSpec = {};
    for (const part of spec.split(',')) {
      const [name, value] = part.split(':').map((s) => s.trim());
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) continue;
      if (name === 'rpm' || name === 'tpm' || name === 'rpd') parsed[name] = n;
    }
    out[key] = parsed;
  }
  return out;
}
