import swagger from '@fastify/swagger';
import scalar from '@scalar/fastify-api-reference';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { jsonSchemaTransform, jsonSchemaTransformObject } from 'fastify-type-provider-zod';
import { cookieNames } from '../auth/cookies';
import type { Config } from '../config/env';

const DESCRIPTION = `
REST API behind the BookLeaf Author Support & Communication Portal.

**Authentication.** Browsers sign in with \`POST /api/v1/auth/login\` and receive httpOnly session cookies.
API clients (Postman, scripts) call \`POST /api/v1/auth/token\` and send \`Authorization: Bearer <accessToken>\`.

**Roles.** \`/api/v1/me/*\` is for authors and is always scoped to the caller's own account; \`/api/v1/admin/*\` is for the BookLeaf team.
Authors receive 404 for anything that is not theirs.

**Errors.** Every error is an RFC 9457 \`application/problem+json\` document with a stable \`code\`,
a human \`detail\`, per-field \`errors\` for validation failures and the \`requestId\` to quote to support.

**Concurrency.** Admin ticket reads return an \`ETag\`; send it back as \`If-Match\` on \`PATCH\` to avoid overwriting a colleague's change (412 on conflict).
\`POST\` endpoints that create records accept an \`Idempotency-Key\` (UUID) header so retries never duplicate.

**Realtime.** \`GET /api/v1/events\` is a Server-Sent Events stream of thin change notifications for the caller's role.
`;

export const docsPlugin = fp(async (app: FastifyInstance, options: { config: Config }) => {
  const names = cookieNames(options.config.cookieSecure);
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'BookLeaf Support API', version: '1.0.0', description: DESCRIPTION.trim() },
      servers: [{ url: options.config.PUBLIC_API_URL }],
      tags: [
        { name: 'Auth', description: 'Sign-in, session refresh and sign-out' },
        { name: 'Author', description: "The signed-in author's books, tickets and Ask Leaf" },
        {
          name: 'Admin · Tickets',
          description: 'Ticket queue, triage overrides, replies, notes, assignment',
        },
        { name: 'Admin · Leaf', description: 'AI drafts, re-triage and AI health' },
        { name: 'Admin · Knowledge base', description: 'Policies and calibration examples Leaf uses' },
        { name: 'Admin · Operations', description: 'Authors, insights and incident alerts' },
        { name: 'Shared', description: 'Notifications, attachments and the realtime stream' },
        { name: 'System', description: 'Health checks' },
      ],
      components: {
        securitySchemes: {
          cookieAuth: { type: 'apiKey', in: 'cookie', name: names.access },
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });

  await app.register(scalar, {
    routePrefix: '/docs',
    configuration: { title: 'BookLeaf Support API', theme: 'saturn' },
  });

  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
});
