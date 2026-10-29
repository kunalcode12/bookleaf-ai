import { MarkNotificationsReadRequestSchema, NotificationListResponseSchema } from '@bookleaf/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../../http/context';
import type { NotificationService } from './service';

export const notificationRoutes: FastifyPluginAsyncZod<{ notifications: NotificationService }> = async (
  app,
  { notifications },
) => {
  app.get(
    '/notifications',
    {
      schema: {
        tags: ['Shared'],
        summary: 'Notifications for the signed-in user',
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }),
        response: { 200: NotificationListResponseSchema },
      },
    },
    async (request) => notifications.list(actorOf(request), request.query.limit),
  );

  app.post(
    '/notifications/read',
    {
      schema: {
        tags: ['Shared'],
        summary: 'Mark notifications as read (all, or the given ids)',
        body: MarkNotificationsReadRequestSchema,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await notifications.markRead(actorOf(request), request.body.ids);
      return reply.status(204).send(null);
    },
  );
};
