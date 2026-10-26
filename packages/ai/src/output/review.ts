import type { DraftCheck, GroundingIndex, ToneChecklist } from '@bookleaf/contracts';
import { groundingChecks } from './grounding';
import { lengthChecks, linkChecks, phraseChecks, placeholderChecks, toneChecklist } from './style';

export interface DraftReviewOptions {
  grounding: GroundingIndex;
  needsEscalation: boolean;
  bookTitle: string | null;
  allowedLinkDomains?: readonly string[];
}

export interface DraftReview {
  checks: DraftCheck[];
  checklist: ToneChecklist;
  /** Counts for the UI summary line ("4 facts verified · 1 to check"). */
  summary: { verified: number; quoted: number; unverified: number; warnings: number; errors: number };
}

/**
 * Deterministic review of a reply: every number checked against records and policy, stock
 * phrases and AI mentions flagged, links verified, placeholders caught, tone checklist computed.
 * Pure and browser-safe — the admin editor re-runs it live on every keystroke.
 */
export function reviewDraft(text: string, options: DraftReviewOptions): DraftReview {
  const facts = groundingChecks(text, options.grounding);
  const checks = [
    ...facts,
    ...phraseChecks(text),
    ...placeholderChecks(text),
    ...linkChecks(text, options.allowedLinkDomains),
    ...lengthChecks(text),
  ].sort((a, b) => (a.start ?? Number.MAX_SAFE_INTEGER) - (b.start ?? Number.MAX_SAFE_INTEGER));

  const verified = facts.filter((c) => c.severity === 'ok').length;
  return {
    checks,
    checklist: toneChecklist(text, {
      needsEscalation: options.needsEscalation,
      hasVerifiedFacts: verified > 0,
      bookTitle: options.bookTitle,
    }),
    summary: {
      verified,
      quoted: facts.filter((c) => c.severity === 'info').length,
      unverified: facts.filter((c) => c.severity === 'warning').length,
      warnings: checks.filter((c) => c.severity === 'warning').length,
      errors: checks.filter((c) => c.severity === 'error').length,
    },
  };
}
