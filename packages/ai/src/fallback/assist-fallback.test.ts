import { describe, expect, it } from 'vitest';
import { knowledgeInputs } from '../testing/fixtures';
import { fallbackAnswer, rankSectionsByKeywords, relevantLines } from './assist-fallback';

// Authors only ever see published sections; the tone guide is internal.
const kb = knowledgeInputs().filter((s) => s.slug !== 'communication-tone');
const royalty = kb.find((s) => s.slug === 'royalty-policy')!;

describe('Ask Leaf fallback (no model available)', () => {
  it('finds the policy that matches the question', () => {
    expect(rankSectionsByKeywords('When will I get my royalties?', kb)[0]?.slug).toBe('royalty-policy');
    expect(rankSectionsByKeywords('My book shows unavailable on Amazon', kb)[0]?.slug).toBe(
      'distribution-availability',
    );
  });

  it('quotes the lines that answer "when", not the first line of the policy', () => {
    const lines = relevantLines('When will I get my royalty payment?', royalty);
    expect(lines.join(' ')).toMatch(/paid within 45 days/);
    expect(lines.join(' ')).not.toMatch(/80\/20/);
  });

  it('quotes how royalties are calculated when that is the question', () => {
    expect(relevantLines('Why is my royalty so low? How is it calculated?', royalty).join(' ')).toMatch(
      /net profit|80\/20/i,
    );
  });

  it('always points the author to the team', () => {
    expect(fallbackAnswer('When will I be paid?', [royalty])).toMatch(/BookLeaf team/);
    expect(fallbackAnswer('Something unrelated entirely', [])).toMatch(/specialist will reply/);
  });
});
