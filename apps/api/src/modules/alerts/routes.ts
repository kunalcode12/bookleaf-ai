import {
  AlertParamsSchema,
  IncidentAlertListResponseSchema,
  UpdateAlertRequestSchema,
} from '@bookleaf/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../../http/context';
import type { AlertService } from './service';

const TAG = 'Admin · Operations';

export const alertRoutes: FastifyPluginAsyncZod<{ alerts: AlertService }> = async (app, { alerts }) => {
  app.get(
    '/alerts',
    {
      schema: {
        tags: [TAG],
        summary: 'Possible incidents (clusters of similar tickets, category spikes)',
        // Not z.coerce.boolean(): that would turn the string "false" into true.
        querystring: z.object({
          includeResolved: z
            .enum(['true', 'false'])
            .optional()
            .transform((v) => v === 'true'),
        }),
        response: { 200: IncidentAlertListResponseSchema },
      },
    },
    async (request) => ({ data: await alerts.list(actorOf(request), request.query.includeResolved) }),
  );

  app.patch(
    '/alerts/:alertId',
    {
      schema: {
        tags: [TAG],
        summary: 'Acknowledge or resolve an alert',
        params: AlertParamsSchema,
        body: UpdateAlertRequestSchema,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await alerts.update(actorOf(request), request.params.alertId, request.body.status);
      return reply.status(204).send(null);
    },
  );
};
