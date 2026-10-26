import { z } from 'zod';
import { IdSchema, IsoDateSchema, MoneySchema } from './common';
import { PAYOUT_STATUSES, PRINT_PARTNERS, PRODUCTION_STAGES, SALES_PLATFORMS } from './enums';

export const PayoutInfoSchema = z
  .object({
    status: z.enum(PAYOUT_STATUSES),
    lastPayoutDate: IsoDateSchema.nullable(),
    /** Deadline of the next payout window (quarter end + 45 days). */
    nextPayoutDate: IsoDateSchema.nullable(),
    /** The quarter that payout covers, e.g. "Jul–Sep 2026". */
    nextPayoutPeriod: z.string().nullable(),
    /** Payout windows that passed with no payout recorded while the balance was above the minimum. */
    missedWindows: z.number().int(),
    belowThreshold: z.boolean(),
    thresholdMinor: z.number().int(),
    /** Plain-language explanation shown to authors and given to Leaf as a fact. */
    message: z.string(),
  })
  .meta({ id: 'PayoutInfo' });
export type PayoutInfo = z.infer<typeof PayoutInfoSchema>;

export const ProductionInfoSchema = z
  .object({
    stage: z.enum(PRODUCTION_STAGES),
    stageLabel: z.string(),
    stepNumber: z.number().int(),
    totalSteps: z.number().int(),
    isPublished: z.boolean(),
    stageDescription: z.string(),
    commonDelay: z.string().nullable(),
  })
  .meta({ id: 'ProductionInfo' });
export type ProductionInfo = z.infer<typeof ProductionInfoSchema>;

export const ListingSchema = z.object({
  platform: z.enum(SALES_PLATFORMS),
  label: z.string(),
});

export const BookSchema = z
  .object({
    id: IdSchema,
    externalId: z.string(),
    title: z.string(),
    isbn: z.string(),
    genre: z.string(),
    publicationDate: IsoDateSchema.nullable(),
    status: z.enum(PRODUCTION_STAGES),
    statusLabel: z.string(),
    mrp: MoneySchema.nullable(),
    royaltyPerCopy: MoneySchema.nullable(),
    copiesSold: z.number().int(),
    royaltyEarned: MoneySchema,
    royaltyPaid: MoneySchema,
    royaltyPending: MoneySchema,
    printPartner: z.enum(PRINT_PARTNERS).nullable(),
    printPartnerLabel: z.string().nullable(),
    availableOn: z.array(ListingSchema),
    payout: PayoutInfoSchema,
    production: ProductionInfoSchema,
    openTicketCount: z.number().int(),
  })
  .meta({ id: 'Book' });
export type Book = z.infer<typeof BookSchema>;

export const PortfolioSummarySchema = z
  .object({
    totalBooks: z.number().int(),
    liveBooks: z.number().int(),
    inProductionBooks: z.number().int(),
    copiesSold: z.number().int(),
    royaltyEarned: MoneySchema,
    royaltyPaid: MoneySchema,
    royaltyPending: MoneySchema,
    lastPayoutDate: IsoDateSchema.nullable(),
    nextPayoutDate: IsoDateSchema.nullable(),
    nextPayoutPeriod: z.string().nullable(),
    booksNeedingAttention: z.number().int(),
  })
  .meta({ id: 'PortfolioSummary' });
export type PortfolioSummary = z.infer<typeof PortfolioSummarySchema>;

export const BookListResponseSchema = z
  .object({
    data: z.array(BookSchema),
    summary: PortfolioSummarySchema,
  })
  .meta({ id: 'BookList' });
export type BookListResponse = z.infer<typeof BookListResponseSchema>;

export const BookParamsSchema = z.object({ bookId: IdSchema });
