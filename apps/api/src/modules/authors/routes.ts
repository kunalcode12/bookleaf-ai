import { AuthorDetailSchema, AuthorListResponseSchema, AuthorParamsSchema } from '@bookleaf/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { actorOf } from '../../http/context';
import type { AuthorService } from './service';

const TAG = 'Admin · Operations';

export const authorRoutes: FastifyPluginAsyncZod<{ authors: AuthorService }> = async (app, { authors }) => {
  app.get(
    '/authors',
    {
      schema: {
        tags: [TAG],
        summary: 'All authors with portfolio totals',
        response: { 200: AuthorListResponseSchema },
      },
    },
    async (request) => ({ data: await authors.list(actorOf(request)) }),
  );

  app.get(
    '/authors/:authorId',
    {
      schema: {
        tags: [TAG],
        summary: 'One author: books, royalties and support history',
        params: AuthorParamsSchema,
        response: { 200: AuthorDetailSchema },
      },
    },
    async (request) => authors.get(actorOf(request), request.params.authorId),
  );
};
