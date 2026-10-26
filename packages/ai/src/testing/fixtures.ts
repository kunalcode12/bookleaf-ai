import { KNOWLEDGE_BASE, KNOWLEDGE_EXAMPLES } from '@bookleaf/domain';
import type { GenerateRequest, GenerateResult, LlmProvider, ModelRef, StreamChunk } from '../gateway/types';
import type { BookFacts, KnowledgeExampleInput, KnowledgeSectionInput, TicketInput } from '../types';

export const TODAY = new Date('2026-10-26T09:00:00Z');

export const BK001: BookFacts = {
  id: 'book-1',
  externalId: 'BK001',
  title: 'Whispers of the Ganges',
  isbn: '978-93-5XXXX-01-1',
  genre: 'Literary Fiction',
  stage: 'published_live',
  publicationDate: '2023-06-20',
  mrpMinor: 39_900,
  royaltyPerCopyMinor: 3_500,
  copiesSold: 342,
  earnedMinor: 1_197_000,
  paidMinor: 840_000,
  pendingMinor: 357_000,
  lastPayoutDate: '2025-10-15',
  printPartner: 'in_house',
  platforms: ['amazon_in', 'flipkart', 'bookleaf_store'],
};

export const BK016: BookFacts = {
  id: 'book-16',
  externalId: 'BK016',
  title: 'The Nagpur Notebooks',
  isbn: '978-93-5XXXX-16-5',
  genre: 'Essays / Memoir',
  stage: 'published_live',
  publicationDate: '2024-11-05',
  mrpMinor: 29_900,
  royaltyPerCopyMinor: 2_500,
  copiesSold: 34,
  earnedMinor: 85_000,
  paidMinor: 0,
  pendingMinor: 85_000,
  lastPayoutDate: null,
  printPartner: 'in_house',
  platforms: ['amazon_in', 'bookleaf_store'],
};

export function ticketFor(overrides: Partial<TicketInput> = {}): TicketInput {
  return {
    id: 'ticket-1',
    number: 'BL-1001',
    subject: "Haven't received my royalty",
    description:
      'Hi, my last payout was in October last year and my dashboard shows money pending. When will I be paid?',
    createdAt: new Date('2026-10-25T10:00:00Z'),
    status: 'open',
    category: 'royalty_payments',
    priority: 'high',
    author: {
      id: 'author-1',
      externalId: 'AUTH001',
      name: 'Priya Sharma',
      city: 'Mumbai',
      joinedDate: '2023-03-15',
    },
    book: BK001,
    portfolio: [BK001],
    messages: [],
    contextSummary: null,
    ...overrides,
  };
}

export const knowledgeInputs = (): KnowledgeSectionInput[] =>
  KNOWLEDGE_BASE.map((s) => ({ ...s, version: 1, embedding: null }));

export const exampleInputs = (): KnowledgeExampleInput[] =>
  KNOWLEDGE_EXAMPLES.map((e, i) => ({ id: `ex-${i}`, ...e, sampleReply: null, embedding: null }));

type Script = (request: GenerateRequest, ref: ModelRef) => string | Error | Promise<string | Error>;

/** Scripted provider for tests: each call returns the next scripted output (or throws an Error). */
export class FakeProvider implements LlmProvider {
  calls: Array<{ ref: ModelRef; request: GenerateRequest }> = [];
  constructor(
    readonly id: 'gemini' | 'groq' | 'openrouter',
    private readonly script: Script,
    private readonly streaming = false,
  ) {}

  canStream(): boolean {
    return this.streaming;
  }

  async generate(ref: ModelRef, request: GenerateRequest): Promise<GenerateResult> {
    this.calls.push({ ref, request });
    const out = await this.script(request, ref);
    if (out instanceof Error) throw out;
    return {
      text: out,
      usage: { inputTokens: 100, outputTokens: 50, reasoningTokens: 0, cachedInputTokens: 0 },
      finishReason: 'stop',
      model: ref.model,
    };
  }

  async *stream(ref: ModelRef, request: GenerateRequest): AsyncGenerator<StreamChunk> {
    const result = await this.generate(ref, request);
    for (let i = 0; i < result.text.length; i += 7) yield { type: 'text', text: result.text.slice(i, i + 7) };
    yield { type: 'done', result };
  }
}

export const triageJson = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    category: 'royalty_payments',
    secondaryCategory: null,
    confidence: 0.92,
    priority: 'medium',
    summary: 'Author asks when pending royalty for Whispers of the Ganges will be paid.',
    rationale: 'Mentions missing payout; records show a pending balance above the minimum.',
    sentiment: 'concerned',
    language: 'en',
    signals: {
      moneyOwed: true,
      monthsWaiting: 12,
      dataError: false,
      printDefect: false,
      platformUnavailable: false,
      productionDelay: false,
      legalThreat: false,
      manipulationAttempt: false,
    },
    ...overrides,
  });

export const draftJson = (reply: string, overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    reply,
    factsUsed: ['F6', 'F8', 'F9'],
    policiesUsed: ['royalty-policy'],
    needsEscalation: true,
    escalationTeam: 'finance',
    internalNextSteps: ['Check Q4 2025 – Q2 2026 payout runs for BK001'],
    ...overrides,
  });

export const GOOD_REPLY = `Hi Priya,

I'm sorry you're still waiting — I can see why this is worrying. Our records show ₹3,570 pending for "Whispers of the Ganges", and your last payout was on 15 October 2025.

Royalties are calculated quarterly and paid within 45 days of the quarter ending, so a payout should have reached you since then. That's on us. I've escalated this to our finance team, and we'll get back to you within 48 hours with the payout date.

Please also confirm that your bank account is linked in your dashboard.

Warm regards,
The BookLeaf Author Support Team`;
