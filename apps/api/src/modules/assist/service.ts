import type { Leaf } from '@bookleaf/ai';
import type { AssistFeedbackRequest, AssistRequest, AssistResponse } from '@bookleaf/contracts';
import { type Database, schema, withActor } from '@bookleaf/db';
import { and, eq } from 'drizzle-orm';
import type { RequestActor } from '../../http/context';
import { authorIdOf } from '../../http/context';
import { Errors } from '../../lib/errors';
import { selectBookRecords, toBookFacts } from '../books/records';
import type { KnowledgeService } from '../knowledge/service';

const { authors, assistConversations, assistMessages } = schema;

function subjectFrom(question: string): string {
  const firstSentence = question.split(/(?<=[.?!])\s/)[0] ?? question;
  const trimmed = firstSentence.replace(/\s+/g, ' ').trim();
  const subject = trimmed.length > 90 ? `${trimmed.slice(0, 87)}…` : trimmed;
  return subject.length >= 5 ? subject : 'Question for the BookLeaf team';
}

/**
 * Ask Leaf — instant answers for authors from published policy and their own records. Every
 * exchange is stored (deflection is measured), and when the team must act Leaf hands over a
 * pre-filled query instead of improvising.
 */
export class AssistService {
  constructor(
    private readonly db: Database,
    private readonly leaf: Leaf,
    private readonly knowledge: KnowledgeService,
  ) {}

  async ask(actor: RequestActor, input: AssistRequest): Promise<AssistResponse> {
    const authorId = authorIdOf(actor);
    const context = await withActor(
      this.db,
      actor.db,
      async (tx) => {
        const [author] = await tx
          .select({
            name: authors.name,
            externalId: authors.externalId,
            city: authors.city,
            joinedDate: authors.joinedDate,
          })
          .from(authors)
          .where(eq(authors.id, authorId));
        const records = await selectBookRecords(tx, eq(schema.books.authorId, authorId));
        if (input.conversationId) {
          const [conversation] = await tx
            .select({ id: assistConversations.id })
            .from(assistConversations)
            .where(
              and(
                eq(assistConversations.id, input.conversationId),
                eq(assistConversations.authorId, authorId),
              ),
            );
          if (!conversation) throw Errors.notFound('Conversation');
        }
        return { author: author!, records };
      },
      { readOnly: true },
    );

    const focus = input.bookId ? context.records.find((r) => r.id === input.bookId) : null;
    if (input.bookId && !focus)
      throw Errors.validation([{ path: 'bookId', message: 'Choose one of your own books.' }]);

    const [knowledge, queryEmbedding] = await Promise.all([
      this.knowledge.published(),
      this.leaf.embed([input.question], 'query').then((v) => v?.[0] ?? null),
    ]);
    const outcome = await this.leaf.assist({
      question: input.question,
      author: {
        id: authorId,
        externalId: context.author.externalId,
        name: context.author.name,
        city: context.author.city,
        joinedDate: context.author.joinedDate,
      },
      books: context.records.map(toBookFacts),
      focusBook: focus ? toBookFacts(focus) : null,
      knowledge,
      queryEmbedding,
    });

    const stored = await withActor(this.db, actor.db, async (tx) => {
      let conversationId = input.conversationId;
      if (!conversationId) {
        const [created] = await tx
          .insert(assistConversations)
          .values({ authorId, profileId: actor.profileId, bookId: focus?.id ?? null })
          .returning({ id: assistConversations.id });
        conversationId = created!.id;
      }
      await tx.insert(assistMessages).values({ conversationId, role: 'author', body: input.question });
      const [answer] = await tx
        .insert(assistMessages)
        .values({
          conversationId,
          role: 'leaf',
          body: outcome.answer,
          needsHuman: outcome.needsHuman,
          suggestedCategory: outcome.suggestedCategory,
          sources: outcome.sources,
          origin: outcome.origin,
          provider: outcome.provider,
          model: outcome.model,
        })
        .returning({ id: assistMessages.id });
      return { conversationId, messageId: answer!.id };
    });

    return {
      conversationId: stored.conversationId,
      messageId: stored.messageId,
      answer: outcome.answer,
      needsHuman: outcome.needsHuman,
      suggestedCategory: outcome.suggestedCategory,
      sources: outcome.sources,
      origin: outcome.origin,
      suggestedTicket:
        outcome.needsHuman || outcome.origin === 'fallback'
          ? { bookId: focus?.id ?? null, subject: subjectFrom(input.question), description: input.question }
          : null,
    };
  }

  async feedback(actor: RequestActor, input: AssistFeedbackRequest): Promise<void> {
    const updated = await withActor(this.db, actor.db, async (tx) => {
      const rows = await tx
        .update(assistMessages)
        .set({ helpful: input.helpful })
        .where(and(eq(assistMessages.id, input.messageId), eq(assistMessages.role, 'leaf')))
        .returning({ conversationId: assistMessages.conversationId });
      const row = rows[0];
      if (row && input.helpful) {
        await tx
          .update(assistConversations)
          .set({ resolved: true })
          .where(eq(assistConversations.id, row.conversationId));
      }
      return rows.length;
    });
    if (updated === 0) throw Errors.notFound('Answer');
  }
}
