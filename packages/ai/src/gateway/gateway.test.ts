import { describe, expect, it } from 'vitest';
import { FakeProvider } from '../testing/fixtures';
import { CircuitBreaker } from './circuit-breaker';
import { AllProvidersFailedError, errorFromResponse, ProviderError, parseRetryAfter } from './errors';
import { LlmGateway, type RunOptions } from './gateway';
import { parseRateLimits, RateLimiter } from './rate-limiter';
import type { AiCallEvent, ModelRef } from './types';

const route: ModelRef[] = [
  { provider: 'gemini', model: 'primary' },
  { provider: 'groq', model: 'fallback' },
];

const opts = (overrides: Partial<RunOptions<string>> = {}): RunOptions<string> => ({
  task: 'triage',
  route,
  request: { system: 'sys', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 100 },
  parse: (t) => t,
  timeoutMs: 1000,
  promptVersion: 'test.v1',
  ...overrides,
});

const unavailable = () =>
  new ProviderError('unavailable', 'boom', { provider: 'gemini', model: 'primary', status: 503 });

describe('LlmGateway', () => {
  it('fails over to the next model and records telemetry for every attempt', async () => {
    const events: AiCallEvent[] = [];
    const gemini = new FakeProvider('gemini', () => unavailable());
    const groq = new FakeProvider('groq', () => 'ok from groq');
    const gateway = new LlmGateway({ providers: { gemini, groq }, telemetry: (e) => events.push(e) });

    const run = await gateway.run(opts());
    expect(run.value).toBe('ok from groq');
    expect(run.ref.provider).toBe('groq');
    expect(gemini.calls).toHaveLength(2); // one transient retry on the same model
    expect(events.map((e) => e.outcome)).toEqual(['error', 'error', 'fallback']);
  });

  it('hands a timed-out request to the next model instead of retrying it', async () => {
    const gemini = new FakeProvider(
      'gemini',
      () => new ProviderError('timeout', 'Request timed out', { provider: 'gemini', model: 'primary' }),
    );
    const groq = new FakeProvider('groq', () => 'ok from groq');
    const gateway = new LlmGateway({ providers: { gemini, groq } });
    const run = await gateway.run(opts());
    expect(run.value).toBe('ok from groq');
    expect(gemini.calls).toHaveLength(1);
  });

  it('moves on when output fails validation, without tripping the breaker', async () => {
    const gemini = new FakeProvider('gemini', () => 'not json');
    const groq = new FakeProvider('groq', () => '{"ok":true}');
    const gateway = new LlmGateway({ providers: { gemini, groq } });
    const run = await gateway.run(
      opts({
        parse: (t) => {
          JSON.parse(t);
          return t;
        },
      }),
    );
    expect(run.ref.provider).toBe('groq');
    expect(run.failures[0]?.kind).toBe('invalid_output');
    expect(gateway.health().providers.find((p) => p.id === 'gemini')?.circuit).toBe('closed');
  });

  it('opens the circuit after repeated failures and skips the dead provider instantly', async () => {
    let now = 0;
    const gemini = new FakeProvider('gemini', () => unavailable());
    const groq = new FakeProvider('groq', () => 'ok');
    const gateway = new LlmGateway({ providers: { gemini, groq }, now: () => now });
    for (let i = 0; i < 3; i += 1) await gateway.run(opts());
    const callsBefore = gemini.calls.length;
    await gateway.run(opts());
    expect(gemini.calls.length).toBe(callsBefore); // skipped: circuit open
    expect(gateway.health().status).toBe('degraded');

    now += 61_000; // cooldown elapsed → half-open trial
    await gateway.run(opts());
    expect(gemini.calls.length).toBe(callsBefore + 2);
  });

  it('opens immediately on an invalid API key', async () => {
    const gemini = new FakeProvider(
      'gemini',
      () => new ProviderError('auth', 'bad key', { provider: 'gemini', model: 'primary', status: 401 }),
    );
    const groq = new FakeProvider('groq', () => 'ok');
    const gateway = new LlmGateway({ providers: { gemini, groq } });
    await gateway.run(opts());
    await gateway.run(opts());
    expect(gemini.calls).toHaveLength(1);
  });

  it('skips a model that is at its local rate limit instead of waiting', async () => {
    const gemini = new FakeProvider('gemini', () => 'gemini');
    const groq = new FakeProvider('groq', () => 'groq');
    const gateway = new LlmGateway({
      providers: { gemini, groq },
      limits: { 'gemini:primary': { rpm: 1 } },
      maxQueueWaitMs: 10,
    });
    expect((await gateway.run(opts())).value).toBe('gemini');
    expect((await gateway.run(opts())).value).toBe('groq');
  });

  it('throws AllProvidersFailedError when the whole route fails', async () => {
    const gateway = new LlmGateway({
      providers: { gemini: new FakeProvider('gemini', () => unavailable()) },
    });
    await expect(gateway.run(opts())).rejects.toBeInstanceOf(AllProvidersFailedError);
  });

  it('treats an unconfigured route as offline', async () => {
    const gateway = new LlmGateway({ providers: {} });
    await expect(gateway.run(opts())).rejects.toThrow(/No AI provider/);
    expect(gateway.health().status).toBe('offline');
  });

  it('streams deltas and resets when a streaming model fails mid-answer', async () => {
    let first = true;
    const gemini = new FakeProvider(
      'gemini',
      () => {
        if (first) {
          first = false;
          return 'partial answer that will break';
        }
        return 'unused';
      },
      true,
    );
    // Make the first stream fail after emitting text.
    gemini.stream = async function* () {
      yield { type: 'text', text: 'partial ' };
      throw new ProviderError('unavailable', 'dropped', { provider: 'gemini', model: 'primary' });
    };
    const groq = new FakeProvider('groq', () => 'complete answer');
    const gateway = new LlmGateway({ providers: { gemini, groq } });
    const events: string[] = [];
    for await (const event of gateway.runStream(opts({ task: 'draft' }))) {
      events.push(event.type === 'done' ? `done:${event.run.value}` : event.type);
    }
    expect(events).toEqual(['delta', 'reset', 'done:complete answer']);
  });
});

describe('CircuitBreaker', () => {
  it('allows a single trial in half-open state', () => {
    let now = 0;
    const breaker = new CircuitBreaker(
      {
        failureThreshold: 1,
        cooldownMs: 100,
        maxCooldownMs: 1000,
        authCooldownMs: 1000,
        quotaCooldownMs: 1000,
      },
      () => now,
    );
    breaker.recordFailure('unavailable', 'x');
    expect(breaker.tryAcquire()).toBe(false);
    now = 150;
    expect(breaker.tryAcquire()).toBe(true);
    expect(breaker.tryAcquire()).toBe(false);
    breaker.recordSuccess();
    expect(breaker.current).toBe('closed');
  });

  it('doubles the cooldown while trial requests keep failing, up to the ceiling', () => {
    let now = 0;
    const breaker = new CircuitBreaker(
      {
        failureThreshold: 1,
        cooldownMs: 100,
        maxCooldownMs: 300,
        authCooldownMs: 1000,
        quotaCooldownMs: 1000,
      },
      () => now,
    );
    breaker.recordFailure('timeout', 'x'); // open for 100ms
    now = 100;
    expect(breaker.tryAcquire()).toBe(true);
    breaker.recordFailure('timeout', 'x'); // failed trial: 200ms
    now = 299;
    expect(breaker.tryAcquire()).toBe(false);
    now = 300;
    expect(breaker.tryAcquire()).toBe(true);
    breaker.recordFailure('timeout', 'x'); // 400ms, capped at 300ms
    now = 599;
    expect(breaker.tryAcquire()).toBe(false);
    now = 600;
    expect(breaker.tryAcquire()).toBe(true);
    breaker.recordSuccess();
    expect(breaker.current).toBe('closed');
  });
});

describe('RateLimiter', () => {
  it('enforces requests and tokens per minute', () => {
    let now = 0;
    const limiter = new RateLimiter({ k: { rpm: 2, tpm: 100 } }, () => now);
    expect(limiter.reserve('k', 40)).toBe(0);
    expect(limiter.reserve('k', 40)).toBe(0);
    expect(limiter.reserve('k', 10)).toBeGreaterThan(0);
    now = 61_000;
    expect(limiter.reserve('k', 90)).toBe(0);
    expect(limiter.reserve('k', 20)).toBeGreaterThan(0);
  });

  it('parses env-style specs', () => {
    expect(parseRateLimits('gemini:a=rpm:10,rpd:250;groq:b=tpm:7500')).toEqual({
      'gemini:a': { rpm: 10, rpd: 250 },
      'groq:b': { tpm: 7500 },
    });
  });
});

describe('parseRetryAfter', () => {
  it('reads Retry-After headers and Google RetryInfo', () => {
    expect(parseRetryAfter(new Headers({ 'retry-after': '7' }), null)).toBe(7000);
    expect(parseRetryAfter(null, '{"details":[{"retryDelay":"34s"}]}')).toBe(34_000);
  });
});

describe('errorFromResponse', () => {
  const kindOf429 = (body: string) => errorFromResponse('gemini', 'm', 429, body, null).kind;
  const google = (quotaId: string) =>
    JSON.stringify({
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message:
          'You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests',
        details: [{ violations: [{ quotaId }] }, { retryDelay: '23s' }],
      },
    });

  it('parks a model only for an explicit per-day quota', () => {
    expect(kindOf429(google('GenerateRequestsPerDayPerProjectPerModel-FreeTier'))).toBe('quota_exhausted');
    expect(kindOf429(google('GenerateRequestsPerMinutePerProjectPerModel-FreeTier'))).toBe('rate_limited');
    expect(
      kindOf429('Rate limit reached for model `m` on requests per day (RPD): Limit 1000, Used 1000'),
    ).toBe('quota_exhausted');
    expect(kindOf429('Rate limit reached for model `m` on tokens per minute (TPM): Limit 8000')).toBe(
      'rate_limited',
    );
    expect(kindOf429('{"error":{"message":"Rate limit exceeded: free-models-per-day"}}')).toBe(
      'quota_exhausted',
    );
  });
});
