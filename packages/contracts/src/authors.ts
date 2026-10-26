import { z } from 'zod';
import { BookSchema } from './books';
import { IdSchema, IsoDateSchema, MoneySchema } from './common';
import { AdminTicketListItemSchema } from './tickets';

export const AuthorListItemSchema = z
  .object({
    id: IdSchema,
    externalId: z.string(),
    name: z.string(),
    email: z.string(),
    city: z.string().nullable(),
    joinedDate: IsoDateSchema,
    bookCount: z.number().int(),
    liveBooks: z.number().int(),
    copiesSold: z.number().int(),
    royaltyEarned: MoneySchema,
    royaltyPending: MoneySchema,
    openTickets: z.number().int(),
  })
  .meta({ id: 'AuthorListItem' });
export type AuthorListItem = z.infer<typeof AuthorListItemSchema>;

export const AuthorListResponseSchema = z
  .object({ data: z.array(AuthorListItemSchema) })
  .meta({ id: 'AuthorList' });

export const AuthorDetailSchema = AuthorListItemSchema.extend({
  phone: z.string().nullable(),
  books: z.array(BookSchema),
  tickets: z.array(AdminTicketListItemSchema),
}).meta({ id: 'AuthorDetail' });
export type AuthorDetail = z.infer<typeof AuthorDetailSchema>;

export const AuthorParamsSchema = z.object({ authorId: IdSchema });
