import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema, PersonRefSchema } from './common';
import { TICKET_CATEGORIES } from './enums';
import { LIMITS } from './limits';

export const KbSectionSchema = z
  .object({
    id: IdSchema,
    slug: z.string(),
    title: z.string(),
    body: z.string(),
    categories: z.array(z.enum(TICKET_CATEGORIES)),
    /** Sent with every draft regardless of category (e.g. company overview). */
    alwaysInclude: z.boolean(),
    /** Visible to authors through Ask Leaf. Internal guidance stays unpublished. */
    isPublished: z.boolean(),
    version: z.number().int(),
    tokenEstimate: z.number().int(),
    hasEmbedding: z.boolean(),
    updatedBy: PersonRefSchema.nullable(),
    updatedAt: IsoDateTimeSchema,
  })
  .meta({ id: 'KbSection' });
export type KbSection = z.infer<typeof KbSectionSchema>;

export const KbSectionListResponseSchema = z
  .object({ data: z.array(KbSectionSchema) })
  .meta({ id: 'KbSectionList' });

export const UpdateKbSectionRequestSchema = z
  .object({
    title: z.string().trim().min(3).max(120).optional(),
    body: z.string().trim().min(LIMITS.kbSectionBody.min).max(LIMITS.kbSectionBody.max).optional(),
    categories: z.array(z.enum(TICKET_CATEGORIES)).max(TICKET_CATEGORIES.length).optional(),
    alwaysInclude: z.boolean().optional(),
    isPublished: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update' })
  .meta({ id: 'UpdateKbSectionRequest' });
export type UpdateKbSectionRequest = z.infer<typeof UpdateKbSectionRequestSchema>;

export const KbExampleSchema = z
  .object({
    id: IdSchema,
    category: z.enum(TICKET_CATEGORIES),
    query: z.string(),
    guidance: z.string(),
    sampleReply: z.string().nullable(),
    source: z.enum(['policy_doc', 'promoted']),
    isActive: z.boolean(),
    createdBy: PersonRefSchema.nullable(),
    createdAt: IsoDateTimeSchema,
  })
  .meta({ id: 'KbExample' });
export type KbExample = z.infer<typeof KbExampleSchema>;

export const KbExampleListResponseSchema = z
  .object({ data: z.array(KbExampleSchema) })
  .meta({ id: 'KbExampleList' });

export const PromoteReplyRequestSchema = z
  .object({
    messageId: IdSchema,
    guidance: z.string().trim().min(10).max(500).optional(),
  })
  .meta({ id: 'PromoteReplyRequest' });
export type PromoteReplyRequest = z.infer<typeof PromoteReplyRequestSchema>;

export const UpdateKbExampleRequestSchema = z
  .object({ isActive: z.boolean() })
  .meta({ id: 'UpdateKbExampleRequest' });
