import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema, PersonRefSchema } from './common';
import { ALERT_KINDS, ALERT_STATUSES, TICKET_CATEGORIES, TICKET_STATUSES } from './enums';

export const IncidentAlertSchema = z
  .object({
    id: IdSchema,
    kind: z.enum(ALERT_KINDS),
    status: z.enum(ALERT_STATUSES),
    title: z.string(),
    summary: z.string(),
    category: z.enum(TICKET_CATEGORIES).nullable(),
    ticketCount: z.number().int(),
    tickets: z.array(
      z.object({ id: IdSchema, number: z.string(), subject: z.string(), status: z.enum(TICKET_STATUSES) }),
    ),
    acknowledgedBy: PersonRefSchema.nullable(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .meta({ id: 'IncidentAlert' });
export type IncidentAlert = z.infer<typeof IncidentAlertSchema>;

export const IncidentAlertListResponseSchema = z
  .object({ data: z.array(IncidentAlertSchema) })
  .meta({ id: 'IncidentAlertList' });

export const UpdateAlertRequestSchema = z
  .object({ status: z.enum(['acknowledged', 'resolved']) })
  .meta({ id: 'UpdateAlertRequest' });

export const AlertParamsSchema = z.object({ alertId: IdSchema });
