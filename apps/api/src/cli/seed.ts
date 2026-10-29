import { createContainer } from '../container';
import { bootstrap } from '../runtime';
import { seedDatabase } from '../seed/seed';

/**
 * pnpm db:seed [--no-demo]
 * Idempotent. With the embedded database (pglite://), stop the API first: only one process can
 * open it at a time (or set AUTO_SEED=true and let the API seed itself on start).
 */
const { config, logger } = bootstrap();
const container = await createContainer({ ...config, AUTO_MIGRATE: true }, logger);
try {
  // Start the queue (without workers) so seeded tickets get their triage jobs.
  await container.start({ withWorkers: false });
  const report = await seedDatabase(container, { demoTickets: !process.argv.includes('--no-demo') });
  console.table(report);
} finally {
  await container.stop();
}
