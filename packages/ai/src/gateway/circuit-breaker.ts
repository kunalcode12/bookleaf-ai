import type { ProviderErrorKind } from './errors';

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitOptions {
  failureThreshold: number;
  cooldownMs: number;
  /** Ceiling for the doubling cooldown while a provider keeps failing its trial requests. */
  maxCooldownMs: number;
  authCooldownMs: number;
  quotaCooldownMs: number;
}

const DEFAULTS: CircuitOptions = {
  failureThreshold: 3,
  cooldownMs: 60_000,
  maxCooldownMs: 10 * 60_000,
  authCooldownMs: 10 * 60_000,
  quotaCooldownMs: 15 * 60_000,
};

/**
 * Classic three-state breaker per provider/model. After repeated failures (or one definitive
 * failure such as a bad API key or an exhausted daily quota) the route is skipped for a cooldown,
 * so a dead provider costs nothing instead of a timeout on every ticket. After the cooldown one
 * trial request is let through (half-open); success closes the circuit again.
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openUntil = 0;
  private trialInFlight = false;
  lastError: string | null = null;
  lastFailureAt: number | null = null;
  lastSuccessAt: number | null = null;

  constructor(
    private readonly options: CircuitOptions = DEFAULTS,
    private readonly now: () => number = Date.now,
  ) {}

  get current(): CircuitState {
    if (this.state === 'open' && this.now() >= this.openUntil) return 'half_open';
    return this.state;
  }

  /** Whether a request may proceed now. Claims the single half-open trial slot when applicable. */
  tryAcquire(): boolean {
    const state = this.current;
    if (state === 'closed') return true;
    if (state === 'open') return false;
    if (this.trialInFlight) return false;
    this.state = 'half_open';
    this.trialInFlight = true;
    return true;
  }

  recordSuccess(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.trialInFlight = false;
    this.lastSuccessAt = this.now();
  }

  /** Releases a half-open trial without judging provider health (e.g. invalid JSON output). */
  recordNeutral(): void {
    this.trialInFlight = false;
    if (this.state === 'half_open') this.state = 'closed';
  }

  recordFailure(kind: ProviderErrorKind, message: string, retryAfterMs: number | null = null): void {
    this.lastError = `${kind}: ${message}`.slice(0, 300);
    this.lastFailureAt = this.now();
    this.trialInFlight = false;
    this.consecutiveFailures += 1;

    let cooldown: number | null = null;
    if (kind === 'auth') cooldown = this.options.authCooldownMs;
    else if (kind === 'quota_exhausted') cooldown = Math.max(this.options.quotaCooldownMs, retryAfterMs ?? 0);
    else if (kind === 'rate_limited') cooldown = Math.max(retryAfterMs ?? 0, 15_000);
    else if (this.state === 'half_open' || this.consecutiveFailures >= this.options.failureThreshold) {
      // Every failure past the threshold (failed trials included) doubles the cooldown, so a
      // provider that stays down costs one probe every few minutes rather than one a minute.
      const beyond = Math.max(0, this.consecutiveFailures - this.options.failureThreshold);
      cooldown = Math.min(this.options.cooldownMs * 2 ** beyond, this.options.maxCooldownMs);
    }
    if (cooldown !== null) {
      this.state = 'open';
      this.openUntil = this.now() + cooldown;
    }
  }
}
