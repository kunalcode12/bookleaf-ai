import { customType, timestamp } from 'drizzle-orm/pg-core';

export const tz = { withTimezone: true, mode: 'date' } as const;

export const createdAt = () => timestamp('created_at', tz).notNull().defaultNow();
export const updatedAt = () => timestamp('updated_at', tz).notNull().defaultNow();

/** Postgres full-text search vector (populated by a generated column). */
export const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});

/** Embedding dimension used for tickets, KB sections and examples (gemini-embedding-001 @ 768). */
export const EMBEDDING_DIMENSIONS = 768;
