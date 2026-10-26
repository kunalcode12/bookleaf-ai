import { z } from 'zod';
import { USER_ROLES } from './enums';

export const IdSchema = z.uuid();

/** A ticket can be addressed by UUID or by its human reference (e.g. "BL-1042"). */
export const TicketRefSchema = z
  .string()
  .trim()
  .refine((v) => z.uuid().safeParse(v).success || /^BL-\d{1,9}$/i.test(v), {
    message: 'Expected a ticket id (UUID) or reference like BL-1042',
  });

export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export const IsoDateSchema = z.iso.date();

/** Money is always exchanged in minor units (paise) to avoid floating point drift. */
export const MoneySchema = z
  .object({
    amountMinor: z.number().int(),
    currency: z.literal('INR'),
  })
  .meta({ id: 'Money', description: 'Amount in minor units (paise). ₹3,570 = { amountMinor: 357000 }.' });
export type Money = z.infer<typeof MoneySchema>;

export const PageInfoSchema = z
  .object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  })
  .meta({ id: 'PageInfo' });
export type PageInfo = z.infer<typeof PageInfoSchema>;

export function paginated<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item), pageInfo: PageInfoSchema });
}

export const PersonRefSchema = z
  .object({
    id: IdSchema,
    displayName: z.string(),
    role: z.enum(USER_ROLES),
    title: z.string().nullable(),
  })
  .meta({ id: 'PersonRef' });
export type PersonRef = z.infer<typeof PersonRefSchema>;

export const CursorQuerySchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** Accepts `a,b,c` or repeated params and validates each value against an enum. */
export function csvEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess((input) => {
    if (input === undefined || input === null || input === '') return undefined;
    const list = Array.isArray(input) ? input : String(input).split(',');
    return list.map((v) => String(v).trim()).filter(Boolean);
  }, z.array(z.enum(values)).min(1).optional());
}

export const OkResponseSchema = z.object({ ok: z.literal(true) }).meta({ id: 'Ok' });
