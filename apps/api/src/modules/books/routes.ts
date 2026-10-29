import { BookListResponseSchema, BookParamsSchema, BookSchema } from '@bookleaf/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { actorOf } from '../../http/context';
import type { BookService } from './service';

/** Mounted at /api/v1/me. */
export const bookRoutes: FastifyPluginAsyncZod<{ books: BookService }> = async (app, { books }) => {
  app.get(
    '/books',
    {
      schema: {
        tags: ['Author'],
        summary: 'My bookshelf — every book with sales, royalties, payout status and production stage',
        response: { 200: BookListResponseSchema },
      },
    },
    async (request) => books.listForAuthor(actorOf(request)),
  );

  app.get(
    '/books/:bookId',
    {
      schema: {
        tags: ['Author'],
        summary: 'One of my books',
        params: BookParamsSchema,
        response: { 200: BookSchema },
      },
    },
    async (request) => books.getForAuthor(actorOf(request), request.params.bookId),
  );
};
