import type { Logger } from 'pino';
import type { TicketAiService } from '../modules/ai/service';
import type { AlertService } from '../modules/alerts/service';
import type { KnowledgeService } from '../modules/knowledge/service';
import type { EmailSender } from '../modules/notifications/email';
import { type JobName, type JobPayloads, SCHEDULES } from './definitions';
import type { JobHandler, JobQueue } from './queue';

export interface JobHandlerDeps {
  ai: TicketAiService;
  alerts: AlertService;
  knowledge: KnowledgeService;
  email: EmailSender;
  logger: Logger;
}

/**
 * Registers every background worker and the recurring schedules. A handler that throws is
 * retried by the queue with exponential backoff (see QUEUES); the ticket itself is never lost.
 */
export async function registerJobHandlers(queue: JobQueue, deps: JobHandlerDeps): Promise<void> {
  const { logger } = deps;

  function traced<N extends JobName>(
    name: N,
    handler: (data: JobPayloads[N]) => Promise<void>,
  ): JobHandler<N> {
    return async (data, meta) => {
      const started = Date.now();
      try {
        await handler(data);
        logger.debug({ job: name, ms: Date.now() - started }, 'job done');
      } catch (error) {
        logger.warn({ err: error, job: name, data, retry: meta.retryCount }, 'job failed');
        throw error;
      }
    };
  }

  await queue.work(
    'ticket.triage',
    traced('ticket.triage', (d) => deps.ai.runTriage(d.ticketId, d.reason)),
  );
  await queue.work(
    'ticket.draft',
    traced('ticket.draft', (d) => deps.ai.runDraft(d.ticketId, d.reason)),
  );
  await queue.work(
    'kb.embed',
    traced('kb.embed', () => deps.knowledge.embedPending()),
  );
  await queue.work(
    'alerts.scan',
    traced('alerts.scan', () => deps.alerts.scan()),
  );
  await queue.work(
    'maintenance.sweep',
    traced('maintenance.sweep', () => deps.ai.sweep()),
  );
  await queue.work(
    'notify.email',
    traced('notify.email', (d) => deps.email.send(d)),
  );

  for (const { name, cron } of SCHEDULES) await queue.schedule(name, cron);
}
