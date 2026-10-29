import { createDatabase } from '@bookleaf/db';
import { createContainer } from '../container';
import { bootstrap } from '../runtime';
import { seedDatabase } from '../seed/seed';

/**
 * pnpm db:reset [--yes]
 * Drops every BookLeaf schema (app data, local logins, jobs, migration history), migrates and
 * re-seeds. Refuses to touch a production database without --yes.
 */
const { config, logger } = bootstrap();
if (config.isProduction && !process.argv.includes('--yes')) {
  console.error('Refusing to reset a production database. Re-run with --yes if you really mean it.');
  process.exit(1);
}

const handle = await createDatabase({
  url: config.DATABASE_URL,
  poolMax: 2,
  applicationName: 'bookleaf-reset',
});
try {
  for (const schema of ['app', 'app_local', 'pgboss', 'drizzle']) {
    await handle.query(`drop schema if exists ${schema} cascade`);
  }
  logger.info('schemas dropped');
} finally {
  await handle.close();
}

const container = await createContainer({ ...config, AUTO_MIGRATE: true }, logger);
try {
  await container.start({ withWorkers: false });
  const report = await seedDatabase(container, { demoTickets: !process.argv.includes('--no-demo') });
  console.table(report);
} finally {
  await container.stop();
}
