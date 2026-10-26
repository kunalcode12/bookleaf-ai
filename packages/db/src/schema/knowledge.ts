import { sql } from 'drizzle-orm';
import { boolean, index, integer, text, uniqueIndex, uuid, vector } from 'drizzle-orm/pg-core';
import { createdAt, EMBEDDING_DIMENSIONS, tsvector, updatedAt } from './columns';
import { profiles } from './core';
import { app, kbExampleSource, ticketCategory } from './enums';
import { ticketMessages } from './tickets';

export const kbSections = app.table(
  'kb_sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    categories: ticketCategory('categories').array().notNull().default(sql`'{}'::app.ticket_category[]`),
    alwaysInclude: boolean('always_include').notNull().default(false),
    isPublished: boolean('is_published').notNull().default(true),
    version: integer('version').notNull().default(1),
    tokenEstimate: integer('token_estimate').notNull().default(0),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    embeddingModel: text('embedding_model'),
    /** Section version the stored embedding was computed from. */
    embeddedVersion: integer('embedded_version'),
    search: tsvector('search').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("body", '')), 'B')`,
    ),
    updatedById: uuid('updated_by_id').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('kb_sections_search_idx').using('gin', t.search)],
);

/** Every edit of a section is kept, so a draft can always be traced to the policy text it used. */
export const kbSectionVersions = app.table(
  'kb_section_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => kbSections.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    categories: ticketCategory('categories').array().notNull(),
    editedById: uuid('edited_by_id').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('kb_section_versions_key').on(t.sectionId, t.version)],
);

export const kbExamples = app.table(
  'kb_examples',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    category: ticketCategory('category').notNull(),
    query: text('query').notNull(),
    guidance: text('guidance').notNull(),
    /** For replies promoted from real tickets: the full reply text. */
    sampleReply: text('sample_reply'),
    source: kbExampleSource('source').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    sourceMessageId: uuid('source_message_id').references(() => ticketMessages.id, { onDelete: 'set null' }),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    createdById: uuid('created_by_id').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('kb_examples_category_idx').on(t.category, t.isActive)],
);
