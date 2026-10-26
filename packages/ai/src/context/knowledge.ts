import type { TicketCategory } from '@bookleaf/contracts';
import { estimateTokens } from '../text/tokens';
import type { KnowledgeExampleInput, KnowledgeSectionInput } from '../types';

export interface SelectedSection {
  slug: string;
  title: string;
  body: string;
  version: number;
  tokens: number;
  reason: 'category' | 'secondary' | 'always' | 'semantic';
}

export interface KnowledgeSelection {
  sections: SelectedSection[];
  tokens: number;
  /** Tokens the naive approach (send the entire knowledge base) would have used. */
  baselineTokens: number;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** Similarity above which a section is pulled in on meaning alone (cross-topic tickets). */
const SEMANTIC_ONLY_THRESHOLD = 0.62;

/**
 * Category-scoped retrieval with a semantic assist: the classified category decides the core
 * policy sections, embeddings add a section from another category when the ticket clearly needs
 * it (e.g. a royalty question that also mentions an ISBN mismatch). Hard token budget.
 */
export function selectKnowledge(input: {
  sections: KnowledgeSectionInput[];
  category: TicketCategory;
  secondaryCategory: TicketCategory | null;
  queryEmbedding: number[] | null;
  excludeSlugs?: string[];
  budgetTokens?: number;
  maxSections?: number;
}): KnowledgeSelection {
  const budget = input.budgetTokens ?? 900;
  const maxSections = input.maxSections ?? 3;
  const pool = input.sections.filter((s) => !input.excludeSlugs?.includes(s.slug));

  const scored = pool
    .map((section) => {
      let score = 0;
      let reason: SelectedSection['reason'] | null = null;
      if (section.categories.includes(input.category)) {
        score += 1;
        reason = 'category';
      }
      if (input.secondaryCategory && section.categories.includes(input.secondaryCategory)) {
        score += 0.6;
        reason ??= 'secondary';
      }
      if (section.alwaysInclude) {
        score += 0.9;
        reason ??= 'always';
      }
      if (input.queryEmbedding && section.embedding) {
        const similarity = cosineSimilarity(input.queryEmbedding, section.embedding);
        if (reason || similarity >= SEMANTIC_ONLY_THRESHOLD) {
          score += Math.max(0, similarity) * 0.5;
          reason ??= 'semantic';
        }
      }
      return { section, score, reason };
    })
    .filter((s): s is typeof s & { reason: SelectedSection['reason'] } => s.reason !== null)
    .sort((a, b) => b.score - a.score);

  const sections: SelectedSection[] = [];
  let tokens = 0;
  for (const { section, reason } of scored) {
    if (sections.length >= maxSections) break;
    const cost = estimateTokens(section.body) + 12;
    if (tokens + cost > budget && sections.length > 0) continue;
    sections.push({
      slug: section.slug,
      title: section.title,
      body: section.body,
      version: section.version,
      tokens: cost,
      reason,
    });
    tokens += cost;
  }

  const baselineTokens = pool.reduce((sum, s) => sum + estimateTokens(s.body) + 12, 0);
  return { sections, tokens, baselineTokens };
}

/** Up to `max` calibration examples for the category, closest in meaning first. */
export function selectExamples(
  examples: KnowledgeExampleInput[],
  category: TicketCategory,
  queryEmbedding: number[] | null,
  max = 2,
): KnowledgeExampleInput[] {
  const candidates = examples.filter((e) => e.category === category);
  if (!queryEmbedding) return candidates.slice(0, max);
  return candidates
    .map((e) => ({ e, s: e.embedding ? cosineSimilarity(queryEmbedding, e.embedding) : 0 }))
    .sort((a, b) => b.s - a.s)
    .slice(0, max)
    .map(({ e }) => e);
}
