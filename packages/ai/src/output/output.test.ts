import { describe, expect, it } from 'vitest';
import { buildFactSheet } from '../context/fact-sheet';
import { GOOD_REPLY, knowledgeInputs, TODAY, ticketFor } from '../testing/fixtures';
import { extractClaims } from './claims';
import { buildGroundingIndex, verifyClaims } from './grounding';
import { reviewDraft } from './review';
import { phraseChecks, placeholderChecks, toneChecklist } from './style';

const groundingFor = (authorTexts: string[] = []) => {
  const sheet = buildFactSheet(ticketFor(), TODAY);
  return buildGroundingIndex({
    facts: sheet.facts,
    policies: knowledgeInputs().map((s) => ({ slug: s.slug, body: s.body })),
    authorTexts,
  });
};

describe('extractClaims', () => {
  it('finds amounts, dates, durations, percentages and ISBNs', () => {
    const claims = extractClaims(
      'You have ₹3,570 (Rs. 1,000 minimum) due by 14 November 2026, within 45 days; reprints take 5–7 business days; 80/20 split; ISBN 978-93-5XXXX-01-1; 342 copies.',
    );
    const byKind = Object.fromEntries(claims.map((c) => [c.text, c.value]));
    expect(byKind['₹3,570']).toBe('357000');
    expect(byKind['Rs. 1,000']).toBe('100000');
    expect(byKind['14 November 2026']).toBe('2026-11-14');
    expect(byKind['45 days']).toBe('45 days');
    expect(byKind['5–7 business days']).toBe('5-7 business days');
    expect(byKind['80/20 split']).toBe('80/20');
    expect(byKind['978-93-5XXXX-01-1']).toBe('978935XXXX011');
    expect(byKind['342']).toBe('342');
  });

  it('ignores ticket references and small bare counts, but keeps every timeline', () => {
    const claims = extractClaims('Ticket BL-1042 — 2 copies, update within 2 days');
    expect(claims.map((c) => c.value)).toEqual(['2 days']);
  });
});

describe('grounding', () => {
  it('verifies facts and policies, marks the author’s own numbers as quoted, flags inventions', () => {
    const index = groundingFor(['I sold 200 copies but only got ₹3,000']);
    const claims = verifyClaims(
      'You have ₹3,570 pending, the next payout is due by 14 November 2026 and royalties are paid within 45 days. You mentioned ₹3,000. We will send ₹4,250 tomorrow.',
      index,
    );
    const status = Object.fromEntries(claims.map((c) => [c.text, c.status]));
    expect(status['₹3,570']).toBe('verified');
    expect(status['14 November 2026']).toBe('verified');
    expect(status['45 days']).toBe('verified');
    expect(status['₹3,000']).toBe('quoted');
    expect(status['₹4,250']).toBe('unverified');
  });

  it('accepts a fact date written without its year', () => {
    const claims = verifyClaims('Your last payout was on 15 October.', groundingFor());
    expect(claims[0]?.status).toBe('verified');
  });
});

describe('style checks', () => {
  it('flags generic AI phrasing and internal tool names', () => {
    const checks = phraseChecks(
      'We apologize for any inconvenience. Rest assured, Leaf has it. As an AI, I...',
    );
    expect(checks.map((c) => c.severity)).toEqual(expect.arrayContaining(['warning', 'error']));
    expect(checks.some((c) => c.message.includes('Leaf'))).toBe(true);
    expect(phraseChecks('Thanks, The BookLeaf Author Support Team')).toEqual([]);
  });

  it('blocks unfilled template placeholders', () => {
    expect(placeholderChecks('Hi [[name]],')[0]?.severity).toBe('error');
  });

  it('scores the tone checklist on a good reply', () => {
    expect(
      toneChecklist(GOOD_REPLY, {
        needsEscalation: true,
        hasVerifiedFacts: true,
        bookTitle: 'Whispers of the Ganges',
      }),
    ).toEqual({ acknowledges: true, specific: true, timeline: true, nextStep: true, noFluff: true });
  });
});

describe('reviewDraft', () => {
  it('produces a clean review for a well-grounded reply', () => {
    const review = reviewDraft(GOOD_REPLY, {
      grounding: groundingFor(),
      needsEscalation: true,
      bookTitle: 'Whispers of the Ganges',
    });
    expect(review.summary.unverified).toBe(0);
    expect(review.summary.errors).toBe(0);
    expect(review.summary.verified).toBeGreaterThanOrEqual(3);
  });
});
