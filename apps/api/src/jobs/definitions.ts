export interface JobPayloads {
  'ticket.triage': { ticketId: string; reason: 'created' | 'followup' | 'manual' | 'retry' | 'sweep' };
  'ticket.draft': { ticketId: string; reason: 'initial' | 'stale' | 'manual' | 'retry' | 'sweep' };
  'kb.embed': { sectionId?: string; exampleId?: string };
  'alerts.scan': Record<string, never>;
  'maintenance.sweep': Record<string, never>;
  'notify.email': { to: string; subject: string; text: string };
}

export type JobName = keyof JobPayloads;

export interface QueueSettings {
  /**
   * `short`: at most one *waiting* job per singleton key — a second request for the same ticket
   * while one is queued is dropped (debounce), while a job already running never blocks a new one.
   */
  policy: 'standard' | 'short';
  retryLimit: number;
  retryDelay: number;
  retryBackoff: boolean;
  expireInSeconds: number;
  /** Concurrent jobs per process — kept low so free-tier AI quotas aren't burst. */
  concurrency: number;
}

export const QUEUES: Record<JobName, QueueSettings> = {
  'ticket.triage': {
    policy: 'short',
    retryLimit: 3,
    retryDelay: 20,
    retryBackoff: true,
    expireInSeconds: 180,
    concurrency: 2,
  },
  'ticket.draft': {
    policy: 'short',
    retryLimit: 2,
    retryDelay: 45,
    retryBackoff: true,
    expireInSeconds: 240,
    concurrency: 1,
  },
  'kb.embed': {
    policy: 'short',
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 120,
    concurrency: 1,
  },
  'alerts.scan': {
    policy: 'standard',
    retryLimit: 0,
    retryDelay: 0,
    retryBackoff: false,
    expireInSeconds: 120,
    concurrency: 1,
  },
  'maintenance.sweep': {
    policy: 'standard',
    retryLimit: 0,
    retryDelay: 0,
    retryBackoff: false,
    expireInSeconds: 120,
    concurrency: 1,
  },
  'notify.email': {
    policy: 'standard',
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 60,
    concurrency: 2,
  },
};

/** Default de-duplication key for `short` queues: one waiting job per ticket (or one overall). */
export function defaultSingletonKey<N extends JobName>(name: N, data: JobPayloads[N]): string | undefined {
  if (QUEUES[name].policy !== 'short') return undefined;
  const ticketId = (data as { ticketId?: string }).ticketId;
  return ticketId ? `${name}:${ticketId}` : name;
}

export const SCHEDULES: Array<{ name: JobName; cron: string }> = [
  { name: 'maintenance.sweep', cron: '*/2 * * * *' },
  { name: 'alerts.scan', cron: '*/10 * * * *' },
];
