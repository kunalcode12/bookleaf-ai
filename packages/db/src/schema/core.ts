import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, tz, updatedAt } from './columns';
import { app, printPartner, productionStage, salesPlatform, userRole } from './enums';

export const authors = app.table(
  'authors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Identifier from BookLeaf's source system, e.g. "AUTH001". */
    externalId: text('external_id').notNull().unique(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    city: text('city'),
    joinedDate: date('joined_date', { mode: 'string' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('authors_email_lower_key').on(sql`lower(${t.email})`)],
);

/** A login. `id` is the identity provider's user id (Supabase auth.users.id). */
export const profiles = app.table(
  'profiles',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    role: userRole('role').notNull(),
    displayName: text('display_name').notNull(),
    /** Job title shown in reply signatures, e.g. "Author Success Specialist". */
    title: text('title'),
    authorId: uuid('author_id')
      .unique()
      .references(() => authors.id, { onDelete: 'restrict' }),
    lastSeenAt: timestamp('last_seen_at', tz),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('profiles_email_lower_key').on(sql`lower(${t.email})`),
    // An author login must point at an author record; admins must not.
    check('profiles_author_link_check', sql`(${t.role} = 'author') = (${t.authorId} is not null)`),
  ],
);

export const books = app.table(
  'books',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    externalId: text('external_id').notNull().unique(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => authors.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    isbn: text('isbn').notNull().unique(),
    genre: text('genre').notNull(),
    publicationDate: date('publication_date', { mode: 'string' }),
    stage: productionStage('stage').notNull(),
    // Money is stored in paise (integer minor units).
    mrpMinor: bigint('mrp_minor', { mode: 'number' }),
    royaltyPerCopyMinor: bigint('royalty_per_copy_minor', { mode: 'number' }),
    copiesSold: integer('copies_sold').notNull().default(0),
    royaltyEarnedMinor: bigint('royalty_earned_minor', { mode: 'number' }).notNull().default(0),
    royaltyPaidMinor: bigint('royalty_paid_minor', { mode: 'number' }).notNull().default(0),
    /** Always earned − paid; the database computes it, so it can never drift. */
    royaltyPendingMinor: bigint('royalty_pending_minor', { mode: 'number' })
      .notNull()
      .generatedAlwaysAs(sql`"royalty_earned_minor" - "royalty_paid_minor"`),
    lastPayoutDate: date('last_payout_date', { mode: 'string' }),
    printPartner: printPartner('print_partner'),
    stageUpdatedAt: timestamp('stage_updated_at', tz),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('books_author_idx').on(t.authorId),
    check('books_copies_nonneg_check', sql`${t.copiesSold} >= 0`),
    check(
      'books_money_nonneg_check',
      sql`${t.royaltyEarnedMinor} >= 0 and ${t.royaltyPaidMinor} >= 0 and coalesce(${t.mrpMinor}, 0) >= 0 and coalesce(${t.royaltyPerCopyMinor}, 0) >= 0`,
    ),
    check('books_paid_within_earned_check', sql`${t.royaltyPaidMinor} <= ${t.royaltyEarnedMinor}`),
    // A live book must have its commercial fields.
    check(
      'books_published_fields_check',
      sql`${t.stage} <> 'published_live' or (${t.publicationDate} is not null and ${t.mrpMinor} is not null and ${t.royaltyPerCopyMinor} is not null)`,
    ),
    // Books still in production cannot have sales.
    check(
      'books_unpublished_no_sales_check',
      sql`${t.stage} = 'published_live' or (${t.copiesSold} = 0 and ${t.royaltyEarnedMinor} = 0)`,
    ),
    // BookLeaf's ledger uses a flat per-copy royalty: earned = copies × per-copy royalty.
    // (If per-platform royalty rates are introduced, this moves to a per-platform sales table.)
    check(
      'books_royalty_ledger_check',
      sql`${t.royaltyPerCopyMinor} is null or ${t.royaltyEarnedMinor} = ${t.copiesSold}::bigint * ${t.royaltyPerCopyMinor}`,
    ),
  ],
);

export const bookListings = app.table(
  'book_listings',
  {
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    platform: salesPlatform('platform').notNull(),
    listedAt: timestamp('listed_at', tz).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.platform] })],
);
