import type { ProviderId } from './types';

export type ProviderErrorKind =
  | 'rate_limited'
  | 'quota_exhausted'
  | 'timeout'
  | 'unavailable'
  | 'network'
  | 'auth'
  | 'bad_request'
  | 'safety'
  | 'invalid_output'
  | 'circuit_open'
  | 'local_rate_limit'
  | 'not_configured'
  | 'aborted';

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly provider: ProviderId | 'none';
  readonly model: string;
  readonly status: number | null;
  readonly retryAfterMs: number | null;

  constructor(
    kind: ProviderErrorKind,
    message: string,
    details: {
      provider: ProviderId | 'none';
      model: string;
      status?: number | null;
      retryAfterMs?: number | null;
      cause?: unknown;
    },
  ) {
    super(message, { cause: details.cause });
    this.name = 'ProviderError';
    this.kind = kind;
    this.provider = details.provider;
    this.model = details.model;
    this.status = details.status ?? null;
    this.retryAfterMs = details.retryAfterMs ?? null;
  }

  /**
   * Quick transient failures worth one immediate retry on the same model. A timeout is not one:
   * it has already spent the whole time budget, so the next model in the route gets the request.
   */
  get transient(): boolean {
    return this.kind === 'unavailable' || this.kind === 'network';
  }

  /** Failures that say nothing about provider health (don't trip the circuit breaker). */
  get neutral(): boolean {
    return this.kind === 'invalid_output' || this.kind === 'bad_request' || this.kind === 'safety';
  }
}

/** Every provider in a route failed or was skipped. Pipelines catch this and fall back. */
export class AllProvidersFailedError extends Error {
  constructor(readonly failures: ProviderError[]) {
    super(
      failures.length === 0
        ? 'No AI provider is configured for this task'
        : `All AI providers failed: ${failures.map((f) => `${f.provider}/${f.model}: ${f.kind}`).join('; ')}`,
    );
    this.name = 'AllProvidersFailedError';
  }

  get summary(): string {
    if (this.failures.length === 0) return 'not_configured';
    const kinds = new Set(this.failures.map((f) => f.kind));
    return [...kinds].join(',');
  }
}

/** Parses Retry-After (seconds or HTTP date) and Google's RetryInfo ("34s"). */
export function parseRetryAfter(headers: Headers | null, body: string | null): number | null {
  const header = headers?.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  const match = body ? /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body) : null;
  return match ? Math.round(Number(match[1]) * 1000) : null;
}

export function errorFromResponse(
  provider: ProviderId,
  model: string,
  status: number,
  body: string,
  headers: Headers | null,
): ProviderError {
  const retryAfterMs = parseRetryAfter(headers, body);
  const snippet = body.replace(/\s+/g, ' ').slice(0, 300);
  const details = { provider, model, status, retryAfterMs };
  if (status === 401 || status === 403)
    return new ProviderError('auth', `Authentication failed (${status})`, details);
  if (status === 429) {
    // Only an explicit per-day quota parks the model until the reset. Google says "Quota exceeded"
    // for its per-minute limits too, so that wording alone means a short wait, not a lost day.
    const daily = /PerDay|per[\s_-]?day|daily/i.test(body);
    return new ProviderError(daily ? 'quota_exhausted' : 'rate_limited', `Rate limited: ${snippet}`, details);
  }
  if (status === 408 || status === 504)
    return new ProviderError('timeout', `Upstream timeout (${status})`, details);
  if (status >= 500) return new ProviderError('unavailable', `Upstream error ${status}: ${snippet}`, details);
  return new ProviderError('bad_request', `Request rejected (${status}): ${snippet}`, details);
}
