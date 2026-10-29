import type { TicketCategory } from '@bookleaf/contracts';
import { buildFactSheet } from '../context/fact-sheet';
import { selectKnowledge } from '../context/knowledge';
import { fallbackAnswer, rankSectionsByKeywords } from '../fallback/assist-fallback';
import { classifyByRules } from '../fallback/rules-classifier';
import { AllProvidersFailedError } from '../gateway/errors';
import { containsCanary, createCanary, createNonce } from '../guards/boundary';
import { scanForInjection } from '../guards/injection';
import { linkChecks } from '../output/style';
import {
  ASSIST_PROMPT_VERSION,
  ASSIST_SCHEMA,
  type AssistOutput,
  AssistOutputSchema,
  buildAssistSystemPrompt,
  buildAssistUserMessage,
} from '../prompts/assist';
import { cleanupReply } from '../prompts/draft';
import { extractJsonObject } from '../text/json';
import { redactPii } from '../text/redact';
import { sanitizeUntrusted } from '../text/sanitize';
import type { AuthorFacts, BookFacts, CallContext, KnowledgeSectionInput } from '../types';
import type { PipelineDeps } from './deps';

export interface AssistInput {
  question: string;
  author: AuthorFacts;
  books: BookFacts[];
  focusBook: BookFacts | null;
  /** Published knowledge-base sections only. */
  knowledge: KnowledgeSectionInput[];
  queryEmbedding?: number[] | null;
}

export interface AssistOutcome {
  origin: 'ai' | 'fallback';
  answer: string;
  needsHuman: boolean;
  suggestedCategory: TicketCategory | null;
  sources: Array<{ slug: string; title: string }>;
  flagged: boolean;
  provider: string | null;
  model: string | null;
  aiError: string | null;
}

const MANIPULATION_REFUSAL =
  'I can help with questions about your BookLeaf books, royalties, production and distribution. If you need something else, send a query to the BookLeaf team and a specialist will reply to you directly.';

/**
 * Ask Leaf (author self-service). The only place Leaf speaks to an author without a human in the
 * loop, so it is deliberately narrow: published policy and the author's own records only, no
 * actions, no promises, and a hand-off to a real query whenever the team must act.
 */
export async function runAssist(
  deps: PipelineDeps,
  input: AssistInput,
  options: { context?: CallContext; signal?: AbortSignal } = {},
): Promise<AssistOutcome> {
  const today = deps.now();
  const question = sanitizeUntrusted(input.question, 1000);
  const scan = scanForInjection(question.text, { hiddenCharacters: question.hiddenCharacters });
  const guess = classifyByRules({
    subject: '',
    description: question.text,
    bookStage: input.focusBook?.stage ?? null,
  });

  if (scan.score >= 0.8) {
    return {
      origin: 'fallback',
      answer: MANIPULATION_REFUSAL,
      needsHuman: false,
      suggestedCategory: null,
      sources: [],
      flagged: true,
      provider: null,
      model: null,
      aiError: null,
    };
  }

  const facts = buildFactSheet(
    {
      id: 'assist',
      number: '',
      subject: '',
      description: '',
      createdAt: today,
      status: 'open',
      category: null,
      priority: null,
      author: input.author,
      book: input.focusBook,
      portfolio: input.books,
      messages: [],
      contextSummary: null,
    },
    today,
    { includeTicket: false },
  );
  const selection = selectKnowledge({
    sections: input.knowledge,
    category: guess.category,
    secondaryCategory: null,
    queryEmbedding: input.queryEmbedding ?? null,
    maxSections: 2,
    budgetTokens: 700,
  });
  const canary = createCanary();
  const known = new Map(input.knowledge.map((s) => [s.slug, s.title]));

  try {
    const run = await deps.gateway.run<AssistOutput>({
      task: 'assist',
      route: deps.routes.assist,
      request: {
        system: buildAssistSystemPrompt(selection.sections, canary),
        messages: [
          {
            role: 'user',
            content: buildAssistUserMessage(facts.rendered, redactPii(question.text).text, createNonce()),
          },
        ],
        schema: ASSIST_SCHEMA,
        maxOutputTokens: 900,
        temperature: 0.3,
      },
      parse: (text) => {
        const output = AssistOutputSchema.parse(extractJsonObject(text));
        if (containsCanary(output.answer, canary)) throw new Error('Answer contains the prompt canary');
        return output;
      },
      timeoutMs: deps.timeouts.assist,
      promptVersion: ASSIST_PROMPT_VERSION,
      context: options.context,
      signal: options.signal,
    });
    const output = run.value;
    let answer = cleanupReply(output.answer);
    // Links are never invented for authors: drop any the model produced.
    for (const check of linkChecks(answer, deps.allowedLinkDomains)) {
      if (check.text) answer = answer.replace(check.text, '').replace(/\s{2,}/g, ' ');
    }
    return {
      origin: 'ai',
      answer,
      needsHuman: output.needsHuman,
      suggestedCategory: output.suggestedCategory ?? (output.needsHuman ? guess.category : null),
      sources: [...new Set(output.policiesUsed)]
        .filter((slug) => known.has(slug))
        .map((slug) => ({ slug, title: known.get(slug)! })),
      flagged: scan.score >= 0.5,
      provider: run.ref.provider,
      model: run.result.model,
      aiError: null,
    };
  } catch (error) {
    if (!(error instanceof AllProvidersFailedError)) throw error;
    const sections = rankSectionsByKeywords(question.text, input.knowledge);
    return {
      origin: 'fallback',
      answer: fallbackAnswer(question.text, sections),
      needsHuman: true,
      suggestedCategory: guess.category,
      sources: sections.map((s) => ({ slug: s.slug, title: s.title })),
      flagged: scan.score >= 0.5,
      provider: null,
      model: null,
      aiError: error.summary,
    };
  }
}
