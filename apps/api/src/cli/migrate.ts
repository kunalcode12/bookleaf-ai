import { createDatabase, runMigrations } from '@bookleaf/db';
import { bootstrap } from '../runtime';

const { config, logger } = bootstrap();
const handle = await createDatabase({
  url: config.DATABASE_URL,
  poolMax: 2,
  applicationName: 'bookleaf-migrate',
});
try {
  await runMigrations(handle);
  logger.info({ database: handle.driver }, 'migrations applied');
} finally {
  await handle.close();
}
