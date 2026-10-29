import { AssistFeedbackRequestSchema, AssistRequestSchema, AssistResponseSchema } from '@bookleaf/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../../http/context';
import type { AssistService } from './service';

/** Mounted at /api/v1/me. */
export const assistRoutes: FastifyPluginAsyncZod<{ assist: AssistService }> = async (app, { assist }) => {
  app.post(
    '/assist',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 hour',
          hook: 'preHandler',
          keyGenerator: (r) => actorOf(r).profileId,
        },
      },
      schema: {
        tags: ['Author'],
        summary: 'Ask Leaf — an instant answer from BookLeaf policy and your own records',
        description:
          "Answers general questions immediately. When BookLeaf's team needs to act, `needsHuman` is true and `suggestedTicket` contains a pre-filled query to submit.",
        body: AssistRequestSchema,
        response: { 200: AssistResponseSchema },
      },
    },
    async (request) => assist.ask(actorOf(request), request.body),
  );

  app.post(
    '/assist/feedback',
    {
      schema: {
        tags: ['Author'],
        summary: 'Tell Leaf whether an answer helped',
        body: AssistFeedbackRequestSchema,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await assist.feedback(actorOf(request), request.body);
      return reply.status(204).send(null);
    },
  );
};
