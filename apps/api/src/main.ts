import { buildApp } from './app';
import { createContainer } from './container';
import { bootstrap, onShutdown } from './runtime';
import { isDatabaseEmpty, seedDatabase } from './seed/seed';

const { config, logger } = bootstrap();

const container = await createContainer(config, logger);
await container.start({ withWorkers: config.WORKER_MODE === 'inline' });

if (config.AUTO_SEED && (await isDatabaseEmpty(container.handle))) {
  logger.info('empty database: loading the sample dataset');
  await seedDatabase(container);
}

const app = await buildApp(container);
await app.listen({ host: config.HOST, port: config.PORT });

onShutdown(logger, async () => {
  await app.close();
  await container.stop();
});
