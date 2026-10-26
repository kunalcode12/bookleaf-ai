import { z } from 'zod';
import { IdSchema } from './common';
import { TICKET_CATEGORIES } from './enums';
import { LIMITS } from './limits';

export const AssistRequestSchema = z
  .object({
    question: z
      .string()
      .trim()
      .min(LIMITS.assistQuestion.min, 'Ask a slightly longer question')
      .max(LIMITS.assistQuestion.max),
    /** Optional book the question is about; scopes the facts Leaf can use. */
    bookId: IdSchema.nullable().optional(),
    conversationId: IdSchema.optional(),
  })
  .meta({ id: 'AssistRequest' });
export type AssistRequest = z.infer<typeof AssistRequestSchema>;

export const AssistResponseSchema = z
  .object({
    conversationId: IdSchema,
    messageId: IdSchema,
    answer: z.string(),
    /** Leaf believes the BookLeaf team must act (investigate, fix, re-sync…). */
    needsHuman: z.boolean(),
    suggestedCategory: z.enum(TICKET_CATEGORIES).nullable(),
    sources: z.array(z.object({ slug: z.string(), title: z.string() })),
    origin: z.enum(['ai', 'fallback']),
    suggestedTicket: z
      .object({ bookId: IdSchema.nullable(), subject: z.string(), description: z.string() })
      .nullable(),
  })
  .meta({ id: 'AssistResponse' });
export type AssistResponse = z.infer<typeof AssistResponseSchema>;

export const AssistFeedbackRequestSchema = z
  .object({
    messageId: IdSchema,
    helpful: z.boolean(),
  })
  .meta({ id: 'AssistFeedbackRequest' });
export type AssistFeedbackRequest = z.infer<typeof AssistFeedbackRequestSchema>;
