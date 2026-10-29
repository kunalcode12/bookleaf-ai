import { createContainer } from './container';
import { bootstrap, onShutdown } from './runtime';

/**
 * Standalone background worker (WORKER_MODE=off on the API): triage, drafts, embeddings, alerts,
 * email and housekeeping. Scale it independently of the HTTP tier.
 */
const { config, logger } = bootstrap();
const container = await createContainer(config, logger.child({ process: 'worker' }));
await container.start({ withWorkers: true });
logger.info('worker ready');

onShutdown(logger, () => container.stop());
