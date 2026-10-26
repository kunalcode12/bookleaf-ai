import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, tz, updatedAt } from './columns';
import { authors, books, profiles } from './core';
import { alertKind, alertStatus, app, assistRole, notificationType, ticketCategory } from './enums';
import { tickets } from './tickets';

export const notifications = app.table(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    type: notificationType('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    ticketId: uuid('ticket_id').references(() => tickets.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', tz),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_recipient_idx').on(t.recipientId, t.createdAt.desc()),
    index('notifications_unread_idx').on(t.recipientId).where(sql`${t.readAt} is null`),
  ],
);

/** Possible incidents detected from ticket patterns (e.g. many "unavailable on Amazon" at once). */
export const incidentAlerts = app.table(
  'incident_alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: alertKind('kind').notNull(),
    status: alertStatus('status').notNull().default('open'),
    /** Dedupe key so repeated scans update one alert instead of creating many. */
    fingerprint: text('fingerprint').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    category: ticketCategory('category'),
    ticketIds: uuid('ticket_ids').array().notNull().default(sql`'{}'::uuid[]`),
    acknowledgedById: uuid('acknowledged_by_id').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('incident_alerts_fingerprint_key').on(t.fingerprint)],
);

export const assistConversations = app.table(
  'assist_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => authors.id, { onDelete: 'cascade' }),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    bookId: uuid('book_id').references(() => books.id, { onDelete: 'set null' }),
    /** Set when the author says Leaf's answer solved their question (ticket deflected). */
    resolved: boolean('resolved'),
    convertedTicketId: uuid('converted_ticket_id').references(() => tickets.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('assist_conversations_author_idx').on(t.authorId, t.createdAt.desc())],
);

export const assistMessages = app.table(
  'assist_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => assistConversations.id, { onDelete: 'cascade' }),
    role: assistRole('role').notNull(),
    body: text('body').notNull(),
    needsHuman: boolean('needs_human'),
    suggestedCategory: ticketCategory('suggested_category'),
    sources: jsonb('sources').$type<Array<{ slug: string; title: string }>>().notNull().default([]),
    origin: text('origin'),
    helpful: boolean('helpful'),
    provider: text('provider'),
    model: text('model'),
    createdAt: createdAt(),
  },
  (t) => [index('assist_messages_conversation_idx').on(t.conversationId, t.createdAt)],
);
