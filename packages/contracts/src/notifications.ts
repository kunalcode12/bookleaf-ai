import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from './common';
import { NOTIFICATION_TYPES } from './enums';

export const NotificationSchema = z
  .object({
    id: IdSchema,
    type: z.enum(NOTIFICATION_TYPES),
    title: z.string(),
    body: z.string(),
    ticketId: IdSchema.nullable(),
    ticketNumber: z.string().nullable(),
    readAt: IsoDateTimeSchema.nullable(),
    createdAt: IsoDateTimeSchema,
  })
  .meta({ id: 'Notification' });
export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationListResponseSchema = z
  .object({
    data: z.array(NotificationSchema),
    unreadCount: z.number().int(),
  })
  .meta({ id: 'NotificationList' });
export type NotificationListResponse = z.infer<typeof NotificationListResponseSchema>;

export const MarkNotificationsReadRequestSchema = z
  .object({
    /** Omit to mark everything read. */
    ids: z.array(IdSchema).max(100).optional(),
  })
  .meta({ id: 'MarkNotificationsReadRequest' });
