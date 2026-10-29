import { estimateTokens } from '@bookleaf/ai';
import type { TicketStatus, UserRole } from '@bookleaf/contracts';
import { type DatabaseHandle, SYSTEM_ACTOR, schema, type Transaction, withActor } from '@bookleaf/db';
import {
  KNOWLEDGE_BASE,
  KNOWLEDGE_EXAMPLES,
  slaDueAt,
  statusAfterAdminReply,
  statusAfterAuthorReply,
} from '@bookleaf/domain';
import { loadSampleDataset } from '@bookleaf/domain/dataset';
import { and, count, eq, notInArray, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { IdentityProvider } from '../auth/identity';
import type { Config } from '../config/env';
import type { JobQueue } from '../jobs/queue';
import type { Clock } from '../lib/clock';
import { ADMIN_SEEDS, type AdminKey } from './accounts';
import { DEMO_TICKETS, type DemoTicket } from './demo-tickets';

const { authors, books, bookListings, profiles, kbSections, kbSectionVersions, kbExamples } = schema;
const { tickets, ticketMessages, ticketNotes, ticketEvents } = schema;

export interface SeedDeps {
  handle: DatabaseHandle;
  identity: IdentityProvider;
  queue: JobQueue;
  config: Config;
  logger: Logger;
  clock: Clock;
}

export interface SeedReport {
  authors: number;
  books: number;
  logins: number;
  kbSections: number;
  kbExamples: number;
  demoTickets: number;
  triageQueued: number;
}

/** True before the first seed (no authors loaded yet). */
export async function isDatabaseEmpty(handle: DatabaseHandle): Promise<boolean> {
  const [row] = await withActor(handle.db, SYSTEM_ACTOR, (tx) => tx.select({ n: count() }).from(authors), {
    readOnly: true,
  });
  return (row?.n ?? 0) === 0;
}

/**
 * Loads the sample dataset, the support team, the knowledge base and (optionally) a demo queue.
 * Safe to run repeatedly: dataset rows are upserted, logins get their seed passwords back, KB
 * edits made in the app are kept, and demo tickets are only created in an empty database.
 */
export async function seedDatabase(
  deps: SeedDeps,
  options: { demoTickets?: boolean } = {},
): Promise<SeedReport> {
  const { handle, identity, queue, config, logger } = deps;
  const db = handle.db;
  const dataset = loadSampleDataset();

  // 1. Authors, books and where each book is listed.
  const ids = await withActor(db, SYSTEM_ACTOR, async (tx) => {
    const authorIds = new Map<string, string>();
    const bookIds = new Map<string, string>();
    for (const author of dataset) {
      const authorValues = {
        externalId: author.externalId,
        name: author.name,
        email: author.email,
        phone: author.phone,
        city: author.city,
        joinedDate: author.joinedDate,
      };
      const [row] = await tx
        .insert(authors)
        .values(authorValues)
        .onConflictDoUpdate({ target: authors.externalId, set: authorValues })
        .returning({ id: authors.id });
      authorIds.set(author.externalId, row!.id);

      for (const book of author.books) {
        const bookValues = {
          externalId: book.externalId,
          authorId: row!.id,
          title: book.title,
          isbn: book.isbn,
          genre: book.genre,
          publicationDate: book.publicationDate,
          stage: book.stage,
          mrpMinor: book.mrpMinor,
          royaltyPerCopyMinor: book.royaltyPerCopyMinor,
          copiesSold: book.copiesSold,
          royaltyEarnedMinor: book.earnedMinor,
          royaltyPaidMinor: book.paidMinor,
          lastPayoutDate: book.lastPayoutDate,
          printPartner: book.printPartner,
        };
        const [bookRow] = await tx
          .insert(books)
          .values(bookValues)
          .onConflictDoUpdate({ target: books.externalId, set: bookValues })
          .returning({ id: books.id });
        const bookId = bookRow!.id;
        bookIds.set(book.externalId, bookId);
        if (book.platforms.length > 0) {
          await tx
            .insert(bookListings)
            .values(book.platforms.map((platform) => ({ bookId, platform })))
            .onConflictDoNothing();
        }
        await tx
          .delete(bookListings)
          .where(
            and(
              eq(bookListings.bookId, bookId),
              book.platforms.length > 0 ? notInArray(bookListings.platform, book.platforms) : undefined,
            ),
          );
      }
    }
    return { authorIds, bookIds };
  });

  // 2. Logins: identity-provider users plus the BookLeaf profile each one maps to.
  const upsertProfile = (values: {
    id: string;
    email: string;
    role: UserRole;
    displayName: string;
    title: string | null;
    authorId: string | null;
  }) =>
    withActor(db, SYSTEM_ACTOR, async (tx) => {
      const [clash] = await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(
          and(sql`lower(${profiles.email}) = lower(${values.email})`, sql`${profiles.id} <> ${values.id}`),
        );
      if (clash) {
        throw new Error(
          `A profile for ${values.email} already exists under a different login id. Reset the database (pnpm db:reset) or remove the stale profile.`,
        );
      }
      const { id: _id, ...updatable } = values;
      await tx.insert(profiles).values(values).onConflictDoUpdate({ target: profiles.id, set: updatable });
    });

  const adminIds = new Map<AdminKey, string>();
  for (const admin of ADMIN_SEEDS) {
    const { userId } = await identity.ensureUser(admin.email, config.SEED_ADMIN_PASSWORD);
    await upsertProfile({
      id: userId,
      email: admin.email,
      role: 'admin',
      displayName: admin.displayName,
      title: admin.title,
      authorId: null,
    });
    adminIds.set(admin.key, userId);
  }
  const authorProfileIds = new Map<string, string>();
  for (const author of dataset) {
    const { userId } = await identity.ensureUser(author.email, config.SEED_AUTHOR_PASSWORD);
    await upsertProfile({
      id: userId,
      email: author.email,
      role: 'author',
      displayName: author.name,
      title: null,
      authorId: ids.authorIds.get(author.externalId)!,
    });
    authorProfileIds.set(author.externalId, userId);
  }

  // 3. Knowledge base. Existing sections are left alone so edits made in the app survive a re-seed.
  const kb = await withActor(db, SYSTEM_ACTOR, async (tx) => {
    let sectionsCreated = 0;
    for (const section of KNOWLEDGE_BASE) {
      const [created] = await tx
        .insert(kbSections)
        .values({
          slug: section.slug,
          title: section.title,
          body: section.body,
          categories: [...section.categories],
          alwaysInclude: section.alwaysInclude,
          isPublished: section.isPublished,
          tokenEstimate: estimateTokens(section.body),
        })
        .onConflictDoNothing({ target: kbSections.slug })
        .returning({ id: kbSections.id });
      if (!created) continue;
      sectionsCreated += 1;
      await tx.insert(kbSectionVersions).values({
        sectionId: created.id,
        version: 1,
        title: section.title,
        body: section.body,
        categories: [...section.categories],
      });
    }
    const [existing] = await tx
      .select({ n: count() })
      .from(kbExamples)
      .where(eq(kbExamples.source, 'policy_doc'));
    let examplesCreated = 0;
    if ((existing?.n ?? 0) === 0) {
      await tx.insert(kbExamples).values(
        KNOWLEDGE_EXAMPLES.map((e) => ({
          category: e.category,
          query: e.query,
          guidance: e.guidance,
          source: 'policy_doc' as const,
        })),
      );
      examplesCreated = KNOWLEDGE_EXAMPLES.length;
    }
    return { sectionsCreated, examplesCreated };
  });
  await queue.send('kb.embed', {});

  // 4. Demo queue (only into an empty ticket table, so real data is never mixed with it).
  let demoTickets = 0;
  let triageQueued = 0;
  if (options.demoTickets ?? true) {
    const [existing] = await withActor(db, SYSTEM_ACTOR, (tx) => tx.select({ n: count() }).from(tickets), {
      readOnly: true,
    });
    if ((existing?.n ?? 0) === 0) {
      const now = deps.clock.now();
      const created = await withActor(db, SYSTEM_ACTOR, async (tx) => {
        const pending: string[] = [];
        for (const demo of DEMO_TICKETS) {
          const id = await insertDemoTicket(tx, demo, {
            now,
            authorId: ids.authorIds.get(demo.author)!,
            authorName: dataset.find((a) => a.externalId === demo.author)!.name,
            authorProfileId: authorProfileIds.get(demo.author)!,
            bookId: demo.book ? ids.bookIds.get(demo.book)! : null,
            adminIds,
          });
          if (!demo.classification) pending.push(id);
        }
        return pending;
      });
      demoTickets = DEMO_TICKETS.length;
      for (const ticketId of created) {
        await queue.send('ticket.triage', { ticketId, reason: 'created' });
        triageQueued += 1;
      }
    }
  }

  const report: SeedReport = {
    authors: dataset.length,
    books: dataset.reduce((n, a) => n + a.books.length, 0),
    logins: ADMIN_SEEDS.length + dataset.length,
    kbSections: kb.sectionsCreated,
    kbExamples: kb.examplesCreated,
    demoTickets,
    triageQueued,
  };
  logger.info(report, 'database seeded');
  return report;
}

interface DemoContext {
  now: Date;
  authorId: string;
  authorName: string;
  authorProfileId: string;
  bookId: string | null;
  adminIds: Map<AdminKey, string>;
}

/** Writes one demo ticket with its full history (thread, notes, audit trail) at backdated times. */
async function insertDemoTicket(tx: Transaction, demo: DemoTicket, ctx: DemoContext): Promise<string> {
  const at = (hoursAgo: number) => new Date(ctx.now.getTime() - hoursAgo * 3_600_000);
  const adminId = (key: AdminKey) => ctx.adminIds.get(key)!;
  const admin = (key: AdminKey) => ADMIN_SEEDS.find((a) => a.key === key)!;

  const createdAt = at(demo.hoursAgo);
  const messages = [...(demo.messages ?? [])].sort((a, b) => b.hoursAgo - a.hoursAgo);
  const adminMessages = messages.filter((m) => m.from !== 'author');
  const authorMessages = messages.filter((m) => m.from === 'author');
  const lastAuthorAt = authorMessages.length > 0 ? at(authorMessages.at(-1)!.hoursAgo) : createdAt;
  const lastAdminAt = adminMessages.length > 0 ? at(adminMessages.at(-1)!.hoursAgo) : null;
  const resolvingMessage = [...adminMessages].reverse().find((m) => m.resolves);
  const closedAt = demo.closedHoursAgo !== undefined ? at(demo.closedHoursAgo) : null;
  const lastActivity = new Date(
    Math.max(
      createdAt.getTime(),
      lastAuthorAt.getTime(),
      lastAdminAt?.getTime() ?? 0,
      closedAt?.getTime() ?? 0,
    ),
  );
  const historical = demo.classification;

  const [ticket] = await tx
    .insert(tickets)
    .values({
      authorId: ctx.authorId,
      bookId: ctx.bookId,
      createdById: ctx.authorProfileId,
      subject: demo.subject,
      description: demo.description,
      status: demo.status,
      ...(historical
        ? {
            category: historical.category,
            categorySource: 'admin' as const,
            priority: historical.priority,
            prioritySource: 'admin' as const,
            slaDueAt: slaDueAt(createdAt, historical.priority),
            triageStatus: 'skipped' as const,
            draftStatus: 'skipped' as const,
          }
        : {}),
      assigneeId: demo.assignee ? adminId(demo.assignee) : null,
      firstResponseAt: adminMessages[0] ? at(adminMessages[0].hoursAgo) : null,
      resolvedAt:
        demo.status === 'resolved' || demo.status === 'closed'
          ? resolvingMessage
            ? at(resolvingMessage.hoursAgo)
            : closedAt
          : null,
      closedAt,
      lastAuthorMessageAt: lastAuthorAt,
      lastAdminMessageAt: lastAdminAt,
      // The author has read everything except BookLeaf's latest reply (shows as unread).
      authorLastReadAt: closedAt ?? lastAuthorAt,
      messageCount: messages.length,
      threadVersion: 1 + messages.length,
      feedbackRating: demo.feedback?.rating ?? null,
      feedbackComment: demo.feedback?.comment ?? null,
      feedbackAt: demo.feedback ? at(demo.feedback.hoursAgo) : null,
      createdAt,
      updatedAt: lastActivity,
    })
    .returning({ id: tickets.id });
  const ticketId = ticket!.id;

  const events: Array<typeof ticketEvents.$inferInsert> = [
    {
      ticketId,
      actorType: 'author',
      actorId: ctx.authorProfileId,
      type: 'ticket.created',
      visibility: 'public',
      payload: { bookId: ctx.bookId },
      createdAt,
    },
  ];

  if (demo.assignee) {
    const firstTouch = adminMessages[0]?.hoursAgo ?? demo.notes?.[0]?.hoursAgo ?? demo.hoursAgo;
    const assignedAt = new Date(Math.max(createdAt.getTime(), at(firstTouch).getTime() - 10 * 60_000));
    events.push({
      ticketId,
      actorType: 'admin',
      actorId: adminId(demo.assignee),
      type: 'ticket.assigned',
      visibility: 'internal',
      payload: { from: null, to: adminId(demo.assignee), toName: admin(demo.assignee).displayName },
      createdAt: assignedAt,
    });
    if (historical) {
      events.push(
        {
          ticketId,
          actorType: 'admin',
          actorId: adminId(demo.assignee),
          type: 'ticket.category_changed',
          visibility: 'internal',
          payload: { from: null, to: historical.category, previousSource: null, aiProposed: null },
          createdAt: assignedAt,
        },
        {
          ticketId,
          actorType: 'admin',
          actorId: adminId(demo.assignee),
          type: 'ticket.priority_changed',
          visibility: 'internal',
          payload: { from: null, to: historical.priority, previousSource: null, aiProposed: null },
          createdAt: assignedAt,
        },
      );
    }
  }

  // Replay the conversation through the real lifecycle rules, so statuses in the audit trail are
  // exactly what the app would have produced.
  let status: TicketStatus = 'open';
  for (const message of messages) {
    const sentAt = at(message.hoursAgo);
    const fromAuthor = message.from === 'author';
    const sender = fromAuthor ? null : admin(message.from as AdminKey);
    const [row] = await tx
      .insert(ticketMessages)
      .values({
        ticketId,
        senderType: fromAuthor ? 'author' : 'admin',
        senderId: fromAuthor ? ctx.authorProfileId : adminId(message.from as AdminKey),
        senderName: sender?.displayName ?? ctx.authorName,
        senderTitle: sender?.title ?? null,
        body: message.body,
        createdAt: sentAt,
      })
      .returning({ id: ticketMessages.id });
    const actor = fromAuthor
      ? { actorType: 'author' as const, actorId: ctx.authorProfileId }
      : { actorType: 'admin' as const, actorId: adminId(message.from as AdminKey) };
    events.push({
      ticketId,
      ...actor,
      type: 'ticket.message_created',
      visibility: 'public',
      payload: { messageId: row!.id, sender: fromAuthor ? 'author' : 'admin' },
      createdAt: sentAt,
    });
    const next: TicketStatus = fromAuthor
      ? statusAfterAuthorReply(status).next
      : statusAfterAdminReply(status, Boolean(message.resolves));
    if (next !== status) {
      events.push({
        ticketId,
        ...actor,
        type: fromAuthor ? 'ticket.reopened' : 'ticket.status_changed',
        visibility: 'public',
        payload: { from: status, to: next },
        createdAt: sentAt,
      });
      status = next;
    }
  }
  if (closedAt) {
    events.push({
      ticketId,
      actorType: 'system',
      actorId: null,
      type: 'ticket.status_changed',
      visibility: 'public',
      payload: {
        from: status,
        to: 'closed',
        reason: 'Closed automatically after the resolution was confirmed',
      },
      createdAt: closedAt,
    });
    status = 'closed';
  }
  if (status !== demo.status) {
    throw new Error(`Demo ticket "${demo.subject}" replays to ${status}, but is declared ${demo.status}.`);
  }

  for (const note of demo.notes ?? []) {
    const [row] = await tx
      .insert(ticketNotes)
      .values({ ticketId, authorId: adminId(note.by), body: note.body, createdAt: at(note.hoursAgo) })
      .returning({ id: ticketNotes.id });
    events.push({
      ticketId,
      actorType: 'admin',
      actorId: adminId(note.by),
      type: 'ticket.note_added',
      visibility: 'internal',
      payload: { noteId: row!.id },
      createdAt: at(note.hoursAgo),
    });
  }
  if (demo.feedback) {
    events.push({
      ticketId,
      actorType: 'author',
      actorId: ctx.authorProfileId,
      type: 'ticket.feedback',
      visibility: 'internal',
      payload: { rating: demo.feedback.rating > 0 ? 'up' : 'down' },
      createdAt: at(demo.feedback.hoursAgo),
    });
  }

  events.sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime());
  await tx.insert(ticketEvents).values(events);
  return ticketId;
}
