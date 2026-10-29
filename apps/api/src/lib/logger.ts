import type { LoggerOptions } from 'pino';
import type { Config } from '../config/env';

/** Structured JSON logs; secrets and personal data are redacted at the source. */
export function loggerOptions(config: Config): LoggerOptions {
  return {
    level: config.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-origin-secret"]',
        'res.headers["set-cookie"]',
        '*.password',
        '*.accessToken',
        '*.refreshToken',
        '*.apiKey',
      ],
      censor: '[redacted]',
    },
    ...(config.isProduction || config.isTest
      ? {}
      : {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,reqId' },
          },
        }),
  };
}
