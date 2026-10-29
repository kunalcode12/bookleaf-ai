import {
  createLeaf,
  type Leaf,
  type LlmTask,
  type ModelRef,
  parseModelSetting,
  parseRateLimits,
  parseRoute,
} from '@bookleaf/ai';
import { createDatabase, type DatabaseHandle, runMigrations } from '@bookleaf/db';
import type { Logger } from 'pino';
import type { IdentityProvider } from './auth/identity';
import { LocalIdentityProvider } from './auth/local-identity';
import { SupabaseIdentityProvider } from './auth/supabase-identity';
import type { Config } from './config/env';
import { registerJobHandlers } from './jobs/handlers';
import { type JobQueue, PgBossQueue } from './jobs/queue';
import { type Clock, systemClock } from './lib/clock';
import { AiRunRecorder } from './modules/ai/runs';
import { TicketAiService } from './modules/ai/service';
import { AlertService } from './modules/alerts/service';
import { AssistService } from './modules/assist/service';
import { AttachmentService } from './modules/attachments/service';
import {
  FileSigner,
  LocalStorageProvider,
  type StorageProvider,
  SupabaseStorageProvider,
} from './modules/attachments/storage';
import { AuthorService } from './modules/authors/service';
import { BookService } from './modules/books/service';
import { InsightsService } from './modules/insights/service';
import { KnowledgeService } from './modules/knowledge/service';
import { type EmailSender, LogEmailSender, ResendEmailSender } from './modules/notifications/email';
import { NotificationService } from './modules/notifications/service';
import { ProfileService } from './modules/profiles/service';
import { RealtimeHub } from './modules/realtime/hub';
import { TicketService } from './modules/tickets/service';

/** Test seams: anything here replaces the production implementation. */
export interface ContainerOverrides {
  handle?: DatabaseHandle;
  clock?: Clock;
  queue?: JobQueue;
  leaf?: Leaf;
  identity?: IdentityProvider;
  email?: EmailSender;
}

export interface Container {
  config: Config;
  logger: Logger;
  clock: Clock;
  handle: DatabaseHandle;
  identity: IdentityProvider;
  queue: JobQueue;
  hub: RealtimeHub;
  leaf: Leaf;
  storage: StorageProvider;
  /** Set when files are stored on local disk (the API serves the signed links itself). */
  localStorage: { storage: LocalStorageProvider; signer: FileSigner } | null;
  email: EmailSender;
  profiles: ProfileService;
  books: BookService;
  notifications: NotificationService;
  attachments: AttachmentService;
  knowledge: KnowledgeService;
  alerts: AlertService;
  tickets: TicketService;
  ai: TicketAiService;
  assist: AssistService;
  authors: AuthorService;
  insights: InsightsService;
  /** Starts realtime, the job queue and (when `withWorkers`) the background workers. */
  start(options: { withWorkers: boolean }): Promise<void>;
  stop(): Promise<void>;
}

function leafRoutes(config: Config): Partial<Record<LlmTask, ModelRef[]>> {
  const routes: Partial<Record<LlmTask, ModelRef[]>> = {};
  const entries: Array<[LlmTask, string | null]> = [
    ['triage', config.LEAF_ROUTE_TRIAGE],
    ['draft', config.LEAF_ROUTE_DRAFT],
    ['assist', config.LEAF_ROUTE_ASSIST],
    ['summarize', config.LEAF_ROUTE_SUMMARIZE],
  ];
  for (const [task, value] of entries) {
    const parsed = parseRoute(value);
    if (parsed) routes[task] = parsed;
  }
  return routes;
}

/**
 * Composition root: builds every adapter and service once, from validated configuration. Nothing
 * else in the codebase reads environment variables or constructs infrastructure.
 */
export async function createContainer(
  config: Config,
  logger: Logger,
  overrides: ContainerOverrides = {},
): Promise<Container> {
  const clock = overrides.clock ?? systemClock;
  const handle =
    overrides.handle ??
    (await createDatabase({
      url: config.DATABASE_URL,
      poolMax: config.DATABASE_POOL_MAX,
      applicationName: 'bookleaf-api',
    }));
  if (config.AUTO_MIGRATE) await runMigrations(handle);

  let identity: IdentityProvider;
  if (overrides.identity) {
    identity = overrides.identity;
  } else if (config.AUTH_PROVIDER === 'supabase') {
    identity = new SupabaseIdentityProvider({
      url: config.SUPABASE_URL!,
      publishableKey: config.SUPABASE_PUBLISHABLE_KEY!,
      secretKey: config.SUPABASE_SECRET_KEY!,
      jwtSecret: config.SUPABASE_JWT_SECRET,
    });
  } else {
    const local = new LocalIdentityProvider(
      handle,
      config.LOCAL_AUTH_SECRET,
      config.LOCAL_ACCESS_TOKEN_TTL_SECONDS,
      clock,
    );
    await local.init();
    identity = local;
  }

  const queue = overrides.queue ?? new PgBossQueue(handle, logger.child({ component: 'jobs' }));
  const hub = new RealtimeHub(handle, logger.child({ component: 'realtime' }));
  const aiRuns = new AiRunRecorder(handle.db, logger);

  const leaf =
    overrides.leaf ??
    createLeaf({
      geminiApiKey: config.GEMINI_API_KEY,
      groqApiKey: config.GROQ_API_KEY,
      openRouterApiKey: config.OPENROUTER_API_KEY,
      appUrl: config.PUBLIC_APP_URL,
      routes: leafRoutes(config),
      embedding: parseModelSetting(config.LEAF_EMBEDDING_MODEL),
      guard: parseModelSetting(config.LEAF_GUARD_MODEL),
      limits: parseRateLimits(config.LEAF_RATE_LIMITS ?? undefined),
      allowedLinkDomains: config.LEAF_ALLOWED_LINK_DOMAINS,
      telemetry: aiRuns.record,
      onHealthChange: (health) => {
        logger.warn({ status: health.status }, 'Leaf health changed');
        void hub.publish({
          type: 'ai.health_changed',
          ticketId: null,
          ticketNumber: null,
          authorId: null,
          recipientId: null,
          visibility: 'internal',
        });
      },
    });

  let storage: StorageProvider;
  let localStorage: Container['localStorage'] = null;
  if (config.STORAGE_PROVIDER === 'supabase') {
    storage = new SupabaseStorageProvider(
      config.SUPABASE_URL!,
      config.SUPABASE_SECRET_KEY!,
      config.STORAGE_BUCKET,
    );
  } else {
    const signer = new FileSigner(config.FILE_SIGNING_SECRET);
    const local = new LocalStorageProvider(config.LOCAL_STORAGE_DIR, signer);
    localStorage = { storage: local, signer };
    storage = local;
  }

  const email =
    overrides.email ??
    (config.RESEND_API_KEY
      ? new ResendEmailSender(config.RESEND_API_KEY, config.EMAIL_FROM)
      : new LogEmailSender(logger));

  const db = handle.db;
  const profiles = new ProfileService(db);
  const notifications = new NotificationService(db, queue, config, logger);
  const attachments = new AttachmentService(db, storage, logger);
  const knowledge = new KnowledgeService(db, queue, hub, leaf, logger);
  const alerts = new AlertService(db, clock, logger);
  const tickets = new TicketService(db, clock, queue, attachments, notifications, logger);
  const ai = new TicketAiService({ db, leaf, knowledge, queue, clock, notifications, alerts, logger });

  let started = false;
  let workers = false;

  return {
    config,
    logger,
    clock,
    handle,
    identity,
    queue,
    hub,
    leaf,
    storage,
    localStorage,
    email,
    profiles,
    books: new BookService(db, clock),
    notifications,
    attachments,
    knowledge,
    alerts,
    tickets,
    ai,
    assist: new AssistService(db, leaf, knowledge),
    authors: new AuthorService(db, clock),
    insights: new InsightsService(db, clock, config.LEAF_PAID_TIER),

    async start({ withWorkers }) {
      if (started) return;
      started = true;
      await storage.init();
      await hub.start();
      await queue.start();
      if (withWorkers) {
        await registerJobHandlers(queue, {
          ai,
          alerts,
          knowledge,
          email,
          logger: logger.child({ component: 'jobs' }),
        });
        workers = true;
      }
      logger.info(
        {
          database: handle.driver,
          auth: identity.kind,
          storage: config.STORAGE_PROVIDER,
          email: email.kind,
          queue: queue.kind,
          workers,
          realtime: hub.listening ? 'listen/notify' : 'polling',
          leaf: leaf.health().status,
        },
        'BookLeaf services started',
      );
    },

    async stop() {
      await hub.stop();
      await queue.stop().catch((error) => logger.warn({ err: error }, 'job queue did not stop cleanly'));
      await aiRuns.flush();
      await handle.close();
    },
  };
}
