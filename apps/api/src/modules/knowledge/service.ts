import {
  estimateTokens,
  type KnowledgeExampleInput,
  type KnowledgeSectionInput,
  type Leaf,
} from '@bookleaf/ai';
import { extractClaims } from '@bookleaf/ai/checks';
import type { KbExample, KbSection, PromoteReplyRequest, UpdateKbSectionRequest } from '@bookleaf/contracts';
import { type Database, SYSTEM_ACTOR, schema, withActor } from '@bookleaf/db';
import { asc, eq, isNull, or, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { RequestActor } from '../../http/context';
import type { JobQueue } from '../../jobs/queue';
import { Errors } from '../../lib/errors';
import type { RealtimeHub } from '../realtime/hub';

const { kbSections, kbSectionVersions, kbExamples, profiles, ticketMessages, tickets, authors, books } =
  schema;
const CACHE_TTL_MS = 60_000;

/** Removes the specifics of one author's case so a promoted reply can calibrate replies to others. */
export function anonymizeReply(text: string, names: string[], titles: string[]): string {
  let out = text;
  // Replace from the end so offsets stay valid.
  for (const claim of extractClaims(out).reverse()) {
    const placeholder =
      claim.kind === 'amount'
        ? '[amount]'
        : claim.kind === 'date'
          ? '[date]'
          : claim.kind === 'isbn'
            ? '[ISBN]'
            : null;
    if (placeholder) out = out.slice(0, claim.start) + placeholder + out.slice(claim.end);
  }
  for (const title of titles.filter(Boolean)) out = out.replaceAll(title, '[book title]');
  for (const name of names.filter((n) => n.length > 1))
    out = out.replace(new RegExp(`\\b${name}\\b`, 'g'), '[author]');
  return out;
}

/**
 * The knowledge base Leaf drafts from. Editable by the ops team (versioned, re-embedded in the
 * background) so policy changes reach Leaf without a deploy; cached for AI use and invalidated on
 * every edit.
 */
export class KnowledgeService {
  private cache: { at: number; sections: KnowledgeSectionInput[]; examples: KnowledgeExampleInput[] } | null =
    null;

  constructor(
    private readonly db: Database,
    private readonly queue: JobQueue,
    private readonly hub: RealtimeHub,
    private readonly leaf: Leaf,
    private readonly logger: Logger,
  ) {}

  invalidate() {
    this.cache = null;
  }

  async forAi(): Promise<{ sections: KnowledgeSectionInput[]; examples: KnowledgeExampleInput[] }> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache;
    const [sections, examples] = await withActor(
      this.db,
      SYSTEM_ACTOR,
      async (tx) =>
        [
          await tx.select().from(kbSections).orderBy(asc(kbSections.title)),
          await tx
            .select()
            .from(kbExamples)
            .where(eq(kbExamples.isActive, true))
            .orderBy(asc(kbExamples.createdAt)),
        ] as const,
      { readOnly: true },
    );
    this.cache = {
      at: Date.now(),
      sections: sections.map((s) => ({
        slug: s.slug,
        title: s.title,
        body: s.body,
        categories: s.categories,
        alwaysInclude: s.alwaysInclude,
        version: s.version,
        embedding: s.embedding ?? null,
      })),
      examples: examples.map((e) => ({
        id: e.id,
        category: e.category,
        query: e.query,
        guidance: e.guidance,
        sampleReply: e.sampleReply,
        embedding: e.embedding ?? null,
      })),
    };
    return this.cache;
  }

  /** Sections authors may see through Ask Leaf. */
  async published(): Promise<KnowledgeSectionInput[]> {
    const { sections } = await this.forAi();
    const published = await withActor(
      this.db,
      SYSTEM_ACTOR,
      (tx) => tx.select({ slug: kbSections.slug }).from(kbSections).where(eq(kbSections.isPublished, true)),
      { readOnly: true },
    );
    const slugs = new Set(published.map((p) => p.slug));
    return sections.filter((s) => slugs.has(s.slug));
  }

  async listSections(actor: RequestActor): Promise<KbSection[]> {
    const rows = await withActor(
      this.db,
      actor.db,
      (tx) =>
        tx
          .select({
            section: kbSections,
            editorName: profiles.displayName,
            editorTitle: profiles.title,
          })
          .from(kbSections)
          .leftJoin(profiles, eq(profiles.id, kbSections.updatedById))
          .orderBy(asc(kbSections.title)),
      { readOnly: true },
    );
    return rows.map((r) => this.toSectionDto(r.section, r.editorName, r.editorTitle));
  }

  private toSectionDto(
    s: typeof kbSections.$inferSelect,
    editorName: string | null,
    editorTitle: string | null,
  ): KbSection {
    return {
      id: s.id,
      slug: s.slug,
      title: s.title,
      body: s.body,
      categories: s.categories,
      alwaysInclude: s.alwaysInclude,
      isPublished: s.isPublished,
      version: s.version,
      tokenEstimate: s.tokenEstimate,
      hasEmbedding: s.embedding !== null && s.embeddedVersion === s.version,
      updatedBy:
        s.updatedById && editorName
          ? { id: s.updatedById, displayName: editorName, role: 'admin', title: editorTitle }
          : null,
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  async updateSection(actor: RequestActor, id: string, patch: UpdateKbSectionRequest): Promise<KbSection> {
    const updated = await withActor(this.db, actor.db, async (tx) => {
      const [current] = await tx.select().from(kbSections).where(eq(kbSections.id, id)).for('update');
      if (!current) throw Errors.notFound('Knowledge base section');
      const next = {
        title: patch.title ?? current.title,
        body: patch.body ?? current.body,
        categories: patch.categories ?? current.categories,
        alwaysInclude: patch.alwaysInclude ?? current.alwaysInclude,
        isPublished: patch.isPublished ?? current.isPublished,
      };
      const contentChanged =
        next.title !== current.title ||
        next.body !== current.body ||
        JSON.stringify(next.categories) !== JSON.stringify(current.categories);
      const version = contentChanged ? current.version + 1 : current.version;
      const [row] = await tx
        .update(kbSections)
        .set({ ...next, version, tokenEstimate: estimateTokens(next.body), updatedById: actor.profileId })
        .where(eq(kbSections.id, id))
        .returning();
      if (contentChanged) {
        await tx.insert(kbSectionVersions).values({
          sectionId: id,
          version,
          title: next.title,
          body: next.body,
          categories: next.categories,
          editedById: actor.profileId,
        });
        await this.queue.send('kb.embed', { sectionId: id }, { tx });
      }
      return row!;
    });
    this.invalidate();
    await this.hub.publish({
      type: 'kb.updated',
      ticketId: null,
      ticketNumber: null,
      authorId: null,
      recipientId: null,
      visibility: 'internal',
    });
    return this.toSectionDto(updated, actor.displayName, actor.title);
  }

  async listExamples(actor: RequestActor): Promise<KbExample[]> {
    const rows = await withActor(
      this.db,
      actor.db,
      (tx) =>
        tx
          .select({ example: kbExamples, creatorName: profiles.displayName, creatorTitle: profiles.title })
          .from(kbExamples)
          .leftJoin(profiles, eq(profiles.id, kbExamples.createdById))
          .orderBy(asc(kbExamples.category), asc(kbExamples.createdAt)),
      { readOnly: true },
    );
    return rows.map(({ example: e, creatorName, creatorTitle }) => ({
      id: e.id,
      category: e.category,
      query: e.query,
      guidance: e.guidance,
      sampleReply: e.sampleReply,
      source: e.source,
      isActive: e.isActive,
      createdBy:
        e.createdById && creatorName
          ? { id: e.createdById, displayName: creatorName, role: 'admin', title: creatorTitle }
          : null,
      createdAt: e.createdAt.toISOString(),
    }));
  }

  async setExampleActive(actor: RequestActor, id: string, isActive: boolean): Promise<void> {
    const rows = await withActor(this.db, actor.db, (tx) =>
      tx.update(kbExamples).set({ isActive }).where(eq(kbExamples.id, id)).returning({ id: kbExamples.id }),
    );
    if (rows.length === 0) throw Errors.notFound('Example');
    this.invalidate();
  }

  /** Turns a reply a specialist actually sent into a calibration example for future drafts. */
  async promoteReply(actor: RequestActor, input: PromoteReplyRequest): Promise<KbExample> {
    const example = await withActor(this.db, actor.db, async (tx) => {
      const [source] = await tx
        .select({
          body: ticketMessages.body,
          sender: ticketMessages.senderType,
          description: tickets.description,
          category: tickets.category,
          authorName: authors.name,
          bookTitle: books.title,
        })
        .from(ticketMessages)
        .innerJoin(tickets, eq(tickets.id, ticketMessages.ticketId))
        .innerJoin(authors, eq(authors.id, tickets.authorId))
        .leftJoin(books, eq(books.id, tickets.bookId))
        .where(eq(ticketMessages.id, input.messageId));
      if (!source) throw Errors.notFound('Message');
      if (source.sender !== 'admin')
        throw Errors.badRequest('Only replies sent by the BookLeaf team can be promoted.');
      if (!source.category) throw Errors.badRequest('Classify the ticket before promoting its reply.');
      const names = source.authorName.split(/\s+/);
      const titles = source.bookTitle ? [source.bookTitle] : [];
      const [row] = await tx
        .insert(kbExamples)
        .values({
          category: source.category,
          query: anonymizeReply(source.description, names, titles).slice(0, 600),
          guidance:
            input.guidance ??
            'Handled well by a BookLeaf specialist — follow this reply’s structure and tone.',
          sampleReply: anonymizeReply(source.body, names, titles),
          source: 'promoted',
          sourceMessageId: input.messageId,
          createdById: actor.profileId,
        })
        .returning();
      await this.queue.send('kb.embed', { exampleId: row!.id }, { tx });
      return row!;
    });
    this.invalidate();
    return {
      id: example.id,
      category: example.category,
      query: example.query,
      guidance: example.guidance,
      sampleReply: example.sampleReply,
      source: example.source,
      isActive: example.isActive,
      createdBy: { id: actor.profileId, displayName: actor.displayName, role: 'admin', title: actor.title },
      createdAt: example.createdAt.toISOString(),
    };
  }

  /** Job: embed sections/examples whose embedding is missing or out of date. */
  async embedPending(): Promise<void> {
    if (!this.leaf.configured.embeddings) return;
    const [sections, examples] = await withActor(
      this.db,
      SYSTEM_ACTOR,
      async (tx) =>
        [
          await tx
            .select({
              id: kbSections.id,
              title: kbSections.title,
              body: kbSections.body,
              version: kbSections.version,
            })
            .from(kbSections)
            .where(
              or(
                isNull(kbSections.embeddedVersion),
                sql`${kbSections.embeddedVersion} <> ${kbSections.version}`,
              ),
            ),
          await tx
            .select({ id: kbExamples.id, query: kbExamples.query })
            .from(kbExamples)
            .where(isNull(kbExamples.embedding)),
        ] as const,
      { readOnly: true },
    );
    if (sections.length > 0) {
      const vectors = await this.leaf.embed(
        sections.map((s) => `${s.title}\n${s.body}`),
        'document',
      );
      if (vectors) {
        await withActor(this.db, SYSTEM_ACTOR, async (tx) => {
          for (const [i, s] of sections.entries()) {
            await tx
              .update(kbSections)
              .set({
                embedding: vectors[i]!,
                embeddedVersion: s.version,
                embeddingModel: this.leaf.embeddingModel,
              })
              .where(eq(kbSections.id, s.id));
          }
        });
      }
    }
    if (examples.length > 0) {
      const vectors = await this.leaf.embed(
        examples.map((e) => e.query),
        'document',
      );
      if (vectors) {
        await withActor(this.db, SYSTEM_ACTOR, async (tx) => {
          for (const [i, e] of examples.entries()) {
            await tx.update(kbExamples).set({ embedding: vectors[i]! }).where(eq(kbExamples.id, e.id));
          }
        });
      }
    }
    if (sections.length + examples.length > 0) {
      this.invalidate();
      this.logger.info({ sections: sections.length, examples: examples.length }, 'knowledge base embedded');
    }
  }
}
