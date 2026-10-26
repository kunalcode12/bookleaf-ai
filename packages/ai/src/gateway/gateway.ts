import type { AiTask } from '@bookleaf/contracts';
import { estimateTokens } from '../text/tokens';
import type { CallContext } from '../types';
import { CircuitBreaker, type CircuitState } from './circuit-breaker';
import { AllProvidersFailedError, ProviderError } from './errors';
import { estimateCostUsd } from './pricing';
import { RateLimiter, type RateLimitSpec } from './rate-limiter';
import {
  type AiCallEvent,
  type EmbeddingProvider,
  type GenerateRequest,
  type GenerateResult,
  type GuardProvider,
  type LlmProvider,
  type ModelRef,
  modelKey,
  type ProviderId,
  type TelemetrySink,
  type Usage,
  ZERO_USAGE,
} from './types';

export interface GatewayOptions {
  providers: Partial<Record<ProviderId, LlmProvider>>;
  embedding?: { provider: EmbeddingProvider; model: string } | null;
  guard?: { provider: GuardProvider; model: string } | null;
  limits?: Record<string, RateLimitSpec>;
  telemetry?: TelemetrySink;
  onHealthChange?: (health: GatewayHealth) => void;
  now?: () => number;
  /** Longest the gateway waits for local rate-limit capacity before trying the next model. */
  maxQueueWaitMs?: number;
}

export interface RunOptions<T> {
  task: AiTask;
  route: ModelRef[];
  request: GenerateRequest;
  /** Validates and converts model text; throw to reject the output (next model is tried). */
  parse: (text: string) => T;
  timeoutMs: number;
  promptVersion: string;
  context?: CallContext;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export interface RunResult<T> {
  value: T;
  result: GenerateResult;
  ref: ModelRef;
  latencyMs: number;
  /** Models that failed before this one succeeded (for "served by fallback" telemetry). */
  failures: ProviderError[];
}

export type StreamEvent<T> =
  | { type: 'delta'; text: string }
  /** A streaming model failed mid-answer; discard what was shown, another model is taking over. */
  | { type: 'reset'; reason: string }
  | { type: 'done'; run: RunResult<T> };

export interface ProviderHealth {
  id: ProviderId;
  configured: boolean;
  circuit: CircuitState;
  lastError: string | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
}

export interface GatewayHealth {
  status: 'operational' | 'degraded' | 'offline';
  providers: ProviderHealth[];
}

const ALL_PROVIDERS: ProviderId[] = ['gemini', 'groq', 'openrouter'];
const STATE_RANK: Record<CircuitState, number> = { closed: 0, half_open: 1, open: 2 };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function toProviderError(error: unknown, ref: ModelRef): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new ProviderError(error.name === 'TimeoutError' ? 'timeout' : 'aborted', error.message, {
      provider: ref.provider,
      model: ref.model,
      cause: error,
    });
  }
  return new ProviderError('unavailable', error instanceof Error ? error.message : String(error), {
    provider: ref.provider,
    model: ref.model,
    cause: error,
  });
}

/**
 * The single place Leaf talks to model providers. A request names a *route* — an ordered list
 * of models — and the gateway walks it:
 *
 *   circuit open?  → skip instantly (dead provider costs nothing)
 *   over quota?    → skip to the next model rather than collecting a 429
 *   transient?     → one jittered retry on the same model
 *   bad output?    → validated by `parse`; rejected output moves to the next model
 *
 * Every attempt is reported to telemetry (ai_runs) with tokens, latency and estimated cost.
 * When the whole route fails it throws AllProvidersFailedError, and the calling pipeline falls
 * back to deterministic behaviour — the product never hard-fails because a model did.
 */
export class LlmGateway {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly limiter: RateLimiter;
  private readonly now: () => number;
  private lastStatus: GatewayHealth['status'] | null = null;

  constructor(private readonly options: GatewayOptions) {
    this.now = options.now ?? Date.now;
    this.limiter = new RateLimiter(options.limits ?? {}, this.now);
  }

  get hasLlm(): boolean {
    return Object.values(this.options.providers).some(Boolean);
  }

  get hasEmbeddings(): boolean {
    return Boolean(this.options.embedding);
  }

  get hasGuard(): boolean {
    return Boolean(this.options.guard);
  }

  isConfigured(provider: ProviderId): boolean {
    return Boolean(this.options.providers[provider]);
  }

  private breaker(key: string): CircuitBreaker {
    let breaker = this.breakers.get(key);
    if (!breaker) {
      breaker = new CircuitBreaker(undefined, this.now);
      this.breakers.set(key, breaker);
    }
    return breaker;
  }

  private emit(event: Omit<AiCallEvent, 'estimatedCostUsd' | 'ticketId' | 'draftId'>, context?: CallContext) {
    if (!this.options.telemetry) return;
    try {
      this.options.telemetry({
        ...event,
        estimatedCostUsd: estimateCostUsd(`${event.provider}:${event.model}`, event.usage),
        ticketId: context?.ticketId ?? null,
        draftId: context?.draftId ?? null,
      });
    } catch {
      // Telemetry must never break a request.
    }
  }

  private signalFor(timeoutMs: number, parent?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(timeoutMs);
    return parent ? AbortSignal.any([parent, timeout]) : timeout;
  }

  /** Admission control shared by run/stream: circuit breaker, then local rate limit. */
  private async admit<T>(
    ref: ModelRef,
    opts: RunOptions<T>,
    failures: ProviderError[],
  ): Promise<LlmProvider | null> {
    const provider = this.options.providers[ref.provider];
    if (!provider) {
      failures.push(new ProviderError('not_configured', 'Provider has no API key', { ...ref }));
      return null;
    }
    const key = modelKey(ref);
    const breaker = this.breaker(key);
    if (!breaker.tryAcquire()) {
      failures.push(new ProviderError('circuit_open', breaker.lastError ?? 'Circuit open', { ...ref }));
      this.emit(
        {
          task: opts.task,
          provider: ref.provider,
          model: ref.model,
          promptVersion: opts.promptVersion,
          outcome: 'skipped',
          errorCode: 'circuit_open',
          errorMessage: breaker.lastError,
          attempt: 0,
          usage: ZERO_USAGE,
          latencyMs: 0,
        },
        opts.context,
      );
      return null;
    }
    const estimate =
      estimateTokens(opts.request.system + opts.request.messages.map((m) => m.content).join('\n')) +
      opts.request.maxOutputTokens;
    let wait = this.limiter.reserve(key, estimate);
    if (wait > 0 && wait <= (this.options.maxQueueWaitMs ?? 1500)) {
      await sleep(wait);
      wait = this.limiter.reserve(key, estimate);
    }
    if (wait > 0) {
      breaker.recordNeutral();
      failures.push(
        new ProviderError('local_rate_limit', `At capacity for ${Math.ceil(wait / 1000)}s`, { ...ref }),
      );
      return null;
    }
    return provider;
  }

  private settleFailure(ref: ModelRef, error: ProviderError) {
    const key = modelKey(ref);
    const breaker = this.breaker(key);
    if (error.neutral) breaker.recordNeutral();
    else breaker.recordFailure(error.kind, error.message, error.retryAfterMs);
    if (error.kind === 'rate_limited' || error.kind === 'quota_exhausted') {
      this.limiter.block(
        key,
        error.retryAfterMs ?? (error.kind === 'quota_exhausted' ? 15 * 60_000 : 20_000),
      );
    }
    this.checkHealthChange();
  }

  private settleSuccess(ref: ModelRef) {
    this.breaker(modelKey(ref)).recordSuccess();
    this.checkHealthChange();
  }

  private parseOutput<T>(opts: RunOptions<T>, result: GenerateResult, ref: ModelRef): T {
    try {
      return opts.parse(result.text);
    } catch (error) {
      const truncated = result.finishReason === 'length' ? ' (output was cut off at the token limit)' : '';
      throw new ProviderError(
        'invalid_output',
        `Output failed validation${truncated}: ${(error as Error).message}`,
        {
          ...ref,
          cause: error,
        },
      );
    }
  }

  private report<T>(
    opts: RunOptions<T>,
    ref: ModelRef,
    attempt: number,
    started: number,
    outcome: 'success' | 'error',
    usage: Usage,
    error?: ProviderError,
    fallbackDepth = 0,
  ) {
    this.emit(
      {
        task: opts.task,
        provider: ref.provider,
        model: ref.model,
        promptVersion: opts.promptVersion,
        outcome: outcome === 'success' && fallbackDepth > 0 ? 'fallback' : outcome,
        errorCode: error?.kind ?? null,
        errorMessage: error?.message.slice(0, 500) ?? null,
        attempt,
        usage,
        latencyMs: this.now() - started,
        metadata: { ...opts.metadata, ...(fallbackDepth > 0 ? { fallbackDepth } : {}) },
      },
      opts.context,
    );
  }

  async run<T>(opts: RunOptions<T>): Promise<RunResult<T>> {
    const failures: ProviderError[] = [];
    for (const ref of opts.route) {
      const provider = await this.admit(ref, opts, failures);
      if (!provider) continue;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const started = this.now();
        try {
          const result = await provider.generate(
            ref,
            opts.request,
            this.signalFor(opts.timeoutMs, opts.signal),
          );
          const value = this.parseOutput(opts, result, ref);
          this.settleSuccess(ref);
          this.report(opts, ref, attempt, started, 'success', result.usage, undefined, failures.length);
          return { value, result, ref, latencyMs: this.now() - started, failures };
        } catch (raw) {
          const error = toProviderError(raw, ref);
          this.report(opts, ref, attempt, started, 'error', ZERO_USAGE, error);
          if (error.kind === 'aborted') throw error;
          if (error.transient && attempt === 1) {
            await sleep(300 + Math.random() * 600);
            continue;
          }
          this.settleFailure(ref, error);
          failures.push(error);
          break;
        }
      }
    }
    throw new AllProvidersFailedError(failures.filter((f) => f.kind !== 'not_configured'));
  }

  async *runStream<T>(opts: RunOptions<T>): AsyncGenerator<StreamEvent<T>> {
    const failures: ProviderError[] = [];
    for (const ref of opts.route) {
      const candidate = this.options.providers[ref.provider];
      if (!candidate?.stream || !candidate.canStream(ref, opts.request)) {
        // Non-streaming model in the route: run it alone, then deliver the whole answer at once.
        try {
          const run = await this.run({ ...opts, route: [ref] });
          yield { type: 'done', run: { ...run, failures: [...failures, ...run.failures] } };
          return;
        } catch (error) {
          if (error instanceof AllProvidersFailedError) {
            failures.push(...error.failures);
            continue;
          }
          throw error;
        }
      }
      const provider = await this.admit(ref, opts, failures);
      if (!provider?.stream) continue;
      const started = this.now();
      let emitted = false;
      try {
        let final: GenerateResult | null = null;
        for await (const chunk of provider.stream(
          ref,
          opts.request,
          this.signalFor(opts.timeoutMs, opts.signal),
        )) {
          if (chunk.type === 'text') {
            emitted = true;
            yield { type: 'delta', text: chunk.text };
          } else {
            final = chunk.result;
          }
        }
        if (!final) throw new ProviderError('invalid_output', 'Stream ended without a result', { ...ref });
        const value = this.parseOutput(opts, final, ref);
        this.settleSuccess(ref);
        this.report(opts, ref, 1, started, 'success', final.usage, undefined, failures.length);
        yield { type: 'done', run: { value, result: final, ref, latencyMs: this.now() - started, failures } };
        return;
      } catch (raw) {
        const error = toProviderError(raw, ref);
        this.report(opts, ref, 1, started, 'error', ZERO_USAGE, error);
        if (error.kind === 'aborted') throw error;
        this.settleFailure(ref, error);
        failures.push(error);
        if (emitted) yield { type: 'reset', reason: error.kind };
      }
    }
    throw new AllProvidersFailedError(failures.filter((f) => f.kind !== 'not_configured'));
  }

  /** Embeds texts; returns null (never throws) when embeddings are unavailable. */
  async embed(
    texts: string[],
    kind: 'document' | 'query',
    context?: CallContext,
    timeoutMs = 10_000,
  ): Promise<number[][] | null> {
    const cfg = this.options.embedding;
    if (!cfg || texts.length === 0) return null;
    const ref: ModelRef = { provider: cfg.provider.id, model: cfg.model };
    const breaker = this.breaker(modelKey(ref));
    if (!breaker.tryAcquire()) return null;
    if (this.limiter.reserve(modelKey(ref), 0) > 0) {
      breaker.recordNeutral();
      return null;
    }
    const started = this.now();
    try {
      const { vectors, inputTokens } = await cfg.provider.embed(
        cfg.model,
        texts,
        kind,
        AbortSignal.timeout(timeoutMs),
      );
      this.settleSuccess(ref);
      this.emit(
        {
          task: 'embed',
          provider: ref.provider,
          model: ref.model,
          promptVersion: null,
          outcome: 'success',
          errorCode: null,
          errorMessage: null,
          attempt: 1,
          usage: { ...ZERO_USAGE, inputTokens },
          latencyMs: this.now() - started,
          metadata: { count: texts.length, kind },
        },
        context,
      );
      return vectors;
    } catch (raw) {
      const error = toProviderError(raw, ref);
      this.settleFailure(ref, error);
      this.emit(
        {
          task: 'embed',
          provider: ref.provider,
          model: ref.model,
          promptVersion: null,
          outcome: 'error',
          errorCode: error.kind,
          errorMessage: error.message.slice(0, 500),
          attempt: 1,
          usage: ZERO_USAGE,
          latencyMs: this.now() - started,
        },
        context,
      );
      return null;
    }
  }

  /**
   * Scores text with the prompt-attack classifier. Long text is split into segments (the model
   * reads 512 tokens) scored in parallel; the highest score wins. Null when unavailable.
   */
  async guardScore(text: string, context?: CallContext, timeoutMs = 6_000): Promise<number | null> {
    const cfg = this.options.guard;
    if (!cfg || !text.trim()) return null;
    const ref: ModelRef = { provider: cfg.provider.id, model: cfg.model };
    const breaker = this.breaker(modelKey(ref));
    if (!breaker.tryAcquire()) return null;
    const segments: string[] = [];
    for (let i = 0; i < text.length && segments.length < 3; i += 1600) segments.push(text.slice(i, i + 1800));
    const started = this.now();
    try {
      const signal = AbortSignal.timeout(timeoutMs);
      const results = await Promise.all(segments.map((s) => cfg.provider.score(cfg.model, s, signal)));
      this.settleSuccess(ref);
      const scores = results.map((r) => r.score).filter((s): s is number => s !== null);
      this.emit(
        {
          task: 'guard',
          provider: ref.provider,
          model: ref.model,
          promptVersion: null,
          outcome: 'success',
          errorCode: null,
          errorMessage: null,
          attempt: 1,
          usage: { ...ZERO_USAGE, inputTokens: results.reduce((sum, r) => sum + r.inputTokens, 0) },
          latencyMs: this.now() - started,
          metadata: { segments: segments.length },
        },
        context,
      );
      return scores.length > 0 ? Math.max(...scores) : null;
    } catch (raw) {
      const error = toProviderError(raw, ref);
      this.settleFailure(ref, error);
      this.emit(
        {
          task: 'guard',
          provider: ref.provider,
          model: ref.model,
          promptVersion: null,
          outcome: 'error',
          errorCode: error.kind,
          errorMessage: error.message.slice(0, 500),
          attempt: 1,
          usage: ZERO_USAGE,
          latencyMs: this.now() - started,
        },
        context,
      );
      return null;
    }
  }

  health(): GatewayHealth {
    const providers: ProviderHealth[] = ALL_PROVIDERS.map((id) => {
      const breakers = [...this.breakers.entries()]
        .filter(([key]) => key.startsWith(`${id}:`))
        .map(([, b]) => b);
      const worst = breakers.reduce<CircuitState>(
        (acc, b) => (STATE_RANK[b.current] > STATE_RANK[acc] ? b.current : acc),
        'closed',
      );
      const latest = (pick: (b: CircuitBreaker) => number | null) =>
        breakers.reduce<number | null>((acc, b) => {
          const v = pick(b);
          return v !== null && (acc === null || v > acc) ? v : acc;
        }, null);
      const lastFailure = latest((b) => b.lastFailureAt);
      return {
        id,
        configured: Boolean(this.options.providers[id]),
        circuit: worst,
        lastError: breakers.find((b) => b.lastFailureAt === lastFailure)?.lastError ?? null,
        lastSuccessAt: latest((b) => b.lastSuccessAt),
        lastFailureAt: lastFailure,
      };
    });
    const configured = providers.filter((p) => p.configured);
    let status: GatewayHealth['status'] = 'operational';
    if (configured.length === 0 || configured.every((p) => p.circuit === 'open')) status = 'offline';
    else if (configured.some((p) => p.circuit !== 'closed')) status = 'degraded';
    return { status, providers };
  }

  private checkHealthChange() {
    if (!this.options.onHealthChange) return;
    const health = this.health();
    if (health.status !== this.lastStatus) {
      this.lastStatus = health.status;
      try {
        this.options.onHealthChange(health);
      } catch {
        // ignore listener errors
      }
    }
  }
}
