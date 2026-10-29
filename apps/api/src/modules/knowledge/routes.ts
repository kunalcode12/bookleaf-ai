import {
  IdSchema,
  KbExampleListResponseSchema,
  KbExampleSchema,
  KbSectionListResponseSchema,
  KbSectionSchema,
  PromoteReplyRequestSchema,
  UpdateKbExampleRequestSchema,
  UpdateKbSectionRequestSchema,
} from '@bookleaf/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../../http/context';
import type { KnowledgeService } from './service';

const TAG = 'Admin · Knowledge base';

export const knowledgeRoutes: FastifyPluginAsyncZod<{ knowledge: KnowledgeService }> = async (
  app,
  { knowledge },
) => {
  app.get(
    '/knowledge-base/sections',
    {
      schema: {
        tags: [TAG],
        summary: 'List policy sections',
        response: { 200: KbSectionListResponseSchema },
      },
    },
    async (request) => ({ data: await knowledge.listSections(actorOf(request)) }),
  );

  app.patch(
    '/knowledge-base/sections/:sectionId',
    {
      schema: {
        tags: [TAG],
        summary: 'Edit a policy section (versioned; re-embedded automatically)',
        params: z.object({ sectionId: IdSchema }),
        body: UpdateKbSectionRequestSchema,
        response: { 200: KbSectionSchema },
      },
    },
    async (request) => knowledge.updateSection(actorOf(request), request.params.sectionId, request.body),
  );

  app.get(
    '/knowledge-base/examples',
    {
      schema: {
        tags: [TAG],
        summary: 'List calibration examples Leaf learns tone from',
        response: { 200: KbExampleListResponseSchema },
      },
    },
    async (request) => ({ data: await knowledge.listExamples(actorOf(request)) }),
  );

  app.post(
    '/knowledge-base/examples',
    {
      schema: {
        tags: [TAG],
        summary: 'Promote a sent reply into the example bank (anonymised)',
        body: PromoteReplyRequestSchema,
        response: { 201: KbExampleSchema },
      },
    },
    async (request, reply) =>
      reply.status(201).send(await knowledge.promoteReply(actorOf(request), request.body)),
  );

  app.patch(
    '/knowledge-base/examples/:exampleId',
    {
      schema: {
        tags: [TAG],
        summary: 'Enable or disable an example',
        params: z.object({ exampleId: IdSchema }),
        body: UpdateKbExampleRequestSchema,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await knowledge.setExampleActive(actorOf(request), request.params.exampleId, request.body.isActive);
      return reply.status(204).send(null);
    },
  );
};
