import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from './common';
import { LIMITS } from './limits';

export const CreateUploadRequestSchema = z
  .object({
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .refine((n) => !/[\\/]/.test(n), 'File name cannot contain slashes'),
    mimeType: z
      .string()
      .refine((m) => LIMITS.attachments.mimeTypes.includes(m), 'Only JPG, PNG, WebP images or PDF files'),
    sizeBytes: z
      .number()
      .int()
      .min(1)
      .max(
        LIMITS.attachments.maxBytes,
        `Files can be at most ${LIMITS.attachments.maxBytes / 1024 / 1024} MB`,
      ),
  })
  .meta({ id: 'CreateUploadRequest' });
export type CreateUploadRequest = z.infer<typeof CreateUploadRequestSchema>;

/** Direct-to-storage upload: the browser PUTs the file to `uploadUrl` with these headers. */
export const UploadTargetSchema = z
  .object({
    attachmentId: IdSchema,
    uploadUrl: z.string(),
    method: z.literal('PUT'),
    headers: z.record(z.string(), z.string()),
    expiresAt: IsoDateTimeSchema,
  })
  .meta({ id: 'UploadTarget' });
export type UploadTarget = z.infer<typeof UploadTargetSchema>;
