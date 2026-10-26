import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from './common';
import { TICKET_EVENT_TYPES } from './enums';

/** Everything the realtime stream (GET /api/v1/events) can deliver. */
export const REALTIME_EVENT_TYPES = [
  ...TICKET_EVENT_TYPES,
  'notification.created',
  'alert.created',
  'alert.updated',
  'ai.health_changed',
  'kb.updated',
] as const;
export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];

/**
 * Events are deliberately thin: they say *what changed*, never carry private data. Clients
 * refetch through the REST API, so every byte still passes the API's access checks.
 */
export const RealtimeEventSchema = z
  .object({
    id: z.string(),
    type: z.enum(REALTIME_EVENT_TYPES),
    ticketId: IdSchema.nullable(),
    ticketNumber: z.string().nullable(),
    at: IsoDateTimeSchema,
  })
  .meta({ id: 'RealtimeEvent' });
export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;
