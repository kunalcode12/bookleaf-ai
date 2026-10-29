import type { AiCallEvent } from '@bookleaf/ai';
import { type Database, SYSTEM_ACTOR, schema, withActor } from '@bookleaf/db';
import type { Logger } from 'pino';

/**
 * Persists every provider call (success, failure, skip) to `ai_runs` — the source for cost,
 * latency, failover and quality metrics. Buffered so telemetry never adds latency to a request.
 */
export class AiRunRecorder {
  private buffer: AiCallEvent[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
    private readonly flushIntervalMs = 1500,
  ) {}

  readonly record = (event: AiCallEvent): void => {
    this.buffer.push(event);
    if (this.buffer.length >= 50) {
      void this.flush();
      return;
    }
    if (!this.timer) this.timer = setTimeout(() => void this.flush(), this.flushIntervalMs);
  };

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = this.buffer.splice(0);
    if (batch.length === 0) return;
    try {
      await withActor(this.db, SYSTEM_ACTOR, (tx) =>
        tx.insert(schema.aiRuns).values(
          batch.map((e) => ({
            ticketId: e.ticketId,
            draftId: e.draftId,
            task: e.task,
            provider: e.provider,
            model: e.model,
            promptVersion: e.promptVersion,
            outcome: e.outcome,
            errorCode: e.errorCode,
            errorMessage: e.errorMessage,
            attempt: e.attempt,
            inputTokens: e.usage.inputTokens,
            outputTokens: e.usage.outputTokens,
            reasoningTokens: e.usage.reasoningTokens,
            cachedTokens: e.usage.cachedInputTokens,
            latencyMs: e.latencyMs,
            estimatedCostUsd: e.estimatedCostUsd,
            metadata: e.metadata ?? null,
          })),
        ),
      );
    } catch (error) {
      this.logger.warn({ err: error, events: batch.length }, 'failed to persist AI telemetry');
    }
  }
}
