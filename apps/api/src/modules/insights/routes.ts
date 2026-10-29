import { InsightsQuerySchema, InsightsResponseSchema } from '@bookleaf/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { actorOf } from '../../http/context';
import type { InsightsService } from './service';

export const insightsRoutes: FastifyPluginAsyncZod<{ insights: InsightsService }> = async (
  app,
  { insights },
) => {
  app.get(
    '/insights',
    {
      schema: {
        tags: ['Admin · Operations'],
        summary: 'Support and AI-quality metrics',
        description:
          'Volume, responsiveness and SLA compliance, author satisfaction, and Leaf accountability: override rates, draft adoption and edit distance, fallback rate, tokens vs. the naive baseline, latency per task.',
        querystring: InsightsQuerySchema,
        response: { 200: InsightsResponseSchema },
      },
    },
    async (request) => insights.get(actorOf(request), request.query.days),
  );
};
