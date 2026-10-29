import { timingSafeEqual } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Config } from '../config/env';
import { Errors } from '../lib/errors';

const EXPOSED_HEADERS = ['etag', 'x-request-id', 'retry-after', 'idempotent-replayed', 'location'];

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Transport-level protections: security headers, CORS allowlist, request ids, and
 * `Cache-Control: no-store` on every API response — private data must never be cached by a CDN
 * (Vercel's proxy honours upstream cache headers by default).
 */
export const securityPlugin = fp(async (app: FastifyInstance, options: { config: Config }) => {
  const { config } = options;

  await app.register(helmet, {
    // JSON API: no HTML to protect with CSP (the docs UI relaxes it on its own route).
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: config.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      // Same-origin and server-to-server requests send no Origin header.
      if (!origin || config.APP_ORIGINS.includes(origin)) return cb(null, true);
      cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'content-type',
      'authorization',
      'idempotency-key',
      'if-match',
      'x-request-id',
      'last-event-id',
    ],
    exposedHeaders: EXPOSED_HEADERS,
    maxAge: 600,
  });

  if (config.ORIGIN_SECRET) {
    const secret = config.ORIGIN_SECRET;
    app.addHook('onRequest', async (request) => {
      if (request.url.startsWith('/health')) return;
      const provided = request.headers['x-origin-secret'];
      if (typeof provided !== 'string' || !safeEqual(provided, secret)) {
        throw Errors.forbidden('Direct access to the API is not allowed.');
      }
    });
  }

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    reply.header('vary', 'Origin, Cookie, Authorization');
    return payload;
  });
});
