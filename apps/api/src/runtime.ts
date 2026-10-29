import { config as loadEnvFile } from 'dotenv';
import { type Logger, pino } from 'pino';
import { type Config, ConfigError, loadConfig } from './config/env';
import { loggerOptions } from './lib/logger';

/** Loads `.env` (if present) and validates configuration; exits with a readable message if invalid. */
export function bootstrap(): { config: Config; logger: Logger } {
  loadEnvFile({ quiet: true });
  try {
    const config = loadConfig();
    return { config, logger: pino(loggerOptions(config)) };
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`\n${error.message}\n\nSee apps/api/.env.example for every setting.\n`);
      process.exit(1);
    }
    throw error;
  }
}

/** SIGTERM/SIGINT → orderly shutdown, with a hard deadline so a stuck dependency can't hang a deploy. */
export function onShutdown(logger: Logger, close: () => Promise<void>, timeoutMs = 15_000): void {
  let closing = false;
  const handler = (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'shutting down');
    const timer = setTimeout(() => {
      logger.error('shutdown timed out; exiting');
      process.exit(1);
    }, timeoutMs);
    timer.unref();
    close()
      .then(() => process.exit(0))
      .catch((error) => {
        logger.error({ err: error }, 'error during shutdown');
        process.exit(1);
      });
  };
  process.once('SIGTERM', handler);
  process.once('SIGINT', handler);
  process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'unhandled promise rejection'));
}
