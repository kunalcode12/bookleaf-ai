import { CreateUploadRequestSchema, LIMITS, UploadTargetSchema } from '@bookleaf/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../../http/context';
import { Errors } from '../../lib/errors';
import type { AttachmentService } from './service';
import type { FileSigner, LocalStorageProvider } from './storage';

/** POST /attachments — request a signed upload URL (registered under /me and /admin). */
export const uploadRequestRoutes: FastifyPluginAsyncZod<{
  attachments: AttachmentService;
  tag: string;
}> = async (app, { attachments, tag }) => {
  app.post(
    '/attachments',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 hour',
          hook: 'preHandler',
          keyGenerator: (r) => actorOf(r).profileId,
        },
      },
      schema: {
        tags: [tag],
        summary: 'Create a signed upload URL for an attachment',
        description: `PUT the file to \`uploadUrl\` with the returned headers, then pass \`attachmentId\` when creating the ticket or reply. JPG, PNG, WebP or PDF, up to ${LIMITS.attachments.maxBytes / 1024 / 1024} MB.`,
        body: CreateUploadRequestSchema,
        response: { 201: UploadTargetSchema },
      },
    },
    async (request, reply) =>
      reply.status(201).send(await attachments.createUpload(actorOf(request), request.body)),
  );
};

/**
 * Local-storage only: the signed upload/download endpoints that stand in for a storage
 * service's own signed URLs. Authorised by the HMAC token in the path, not by session.
 */
export const localFileRoutes: FastifyPluginAsyncZod<{
  storage: LocalStorageProvider;
  signer: FileSigner;
}> = async (app, { storage, signer }) => {
  app.addContentTypeParser(
    [...LIMITS.attachments.mimeTypes],
    { parseAs: 'buffer', bodyLimit: LIMITS.attachments.maxBytes },
    (_request, body, done) => done(null, body),
  );

  app.put(
    '/files/upload/:token',
    {
      schema: { hide: true, params: z.object({ token: z.string().min(10).max(2000) }) },
    },
    async (request, reply) => {
      const claims = signer.verify<{ k: string; m: string; op: string }>(request.params.token);
      if (claims?.op !== 'put') throw Errors.forbidden('This upload link is invalid or has expired.');
      if (request.headers['content-type']?.split(';')[0] !== claims.m) {
        throw Errors.badRequest('Content type does not match the upload request.');
      }
      const body = request.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) throw Errors.badRequest('Empty upload.');
      await storage.write(claims.k, body);
      return reply.status(204).send();
    },
  );

  app.get(
    '/files/download/:token',
    { schema: { hide: true, params: z.object({ token: z.string().min(10).max(2000) }) } },
    async (request, reply) => {
      const claims = signer.verify<{ k: string; n: string; op: string }>(request.params.token);
      if (claims?.op !== 'get') throw Errors.forbidden('This download link is invalid or has expired.');
      if (!(await storage.exists(claims.k))) throw Errors.notFound('File');
      reply.header('content-disposition', `attachment; filename="${claims.n.replace(/["\\]/g, '')}"`);
      reply.header('cache-control', 'private, max-age=300');
      return reply.send(storage.read(claims.k));
    },
  );
};
