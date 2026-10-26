import { describe, expect, it } from 'vitest';
import { formatInr, rupeesToMinor } from './money';
import { describeStage, parseStageLabel } from './production';
import { computeSla, expectedResponseLabel, slaDueAt } from './sla';
import {
  allowedTransitions,
  assertTransition,
  statusAfterAdminReply,
  statusAfterAuthorReply,
  TicketLifecycleError,
} from './ticket-lifecycle';
import { applyTriagePolicy, escalateOnly, type TriageProposal } from './triage-policy';
import { urgencyScore } from './urgency';

const noSignals = {
  moneyOwed: false,
  monthsWaiting: null,
  dataError: false,
  printDefect: false,
  platformUnavailable: false,
  productionDelay: false,
  legalThreat: false,
  manipulationAttempt: false,
};

const proposal = (overrides: Partial<TriageProposal>): TriageProposal => ({
  category: 'general_inquiry',
  priority: 'medium',
  confidence: 0.9,
  signals: noSignals,
  sentiment: 'calm',
  ...overrides,
});

const ctx = {
  source: 'ai' as const,
  injectionFlagged: false,
  payoutStatus: null,
  bookStage: 'published_live' as const,
};

describe('money', () => {
  it('formats paise with Indian grouping', () => {
    expect(formatInr(357_000)).toBe('₹3,570');
    expect(formatInr(12_000_000)).toBe('₹1,20,000');
    expect(formatInr(12_345)).toBe('₹123.45');
    expect(rupeesToMinor(399)).toBe(39_900);
  });
});

describe('production stages', () => {
  it('parses the dataset status strings', () => {
    expect(parseStageLabel('Published & Live')).toBe('published_live');
    expect(parseStageLabel('In Production - Cover Design')).toBe('cover_design');
    expect(parseStageLabel('In Production - Typesetting')).toBe('typesetting');
    expect(() => parseStageLabel('Lost in the mail')).toThrow(RangeError);
  });

  it('describes position in the 9-step pipeline', () => {
    expect(describeStage('typesetting')).toMatchObject({ stepNumber: 4, totalSteps: 9, isPublished: false });
    expect(describeStage('cover_design').commonDelay).toMatch(/approv/);
  });
});

describe('sla', () => {
  const created = new Date('2026-10-26T08:00:00Z');

  it('derives deadlines from priority', () => {
    expect(slaDueAt(created, 'critical').toISOString()).toBe('2026-10-26T12:00:00.000Z');
    expect(expectedResponseLabel('low')).toBe('within 2 days');
    expect(expectedResponseLabel('high')).toBe('within 12 hours');
  });

  it('reports on-track, at-risk and breached states', () => {
    const base = {
      priority: 'high' as const,
      status: 'open' as const,
      createdAt: created,
      firstResponseAt: null,
    };
    const dueAt = slaDueAt(created, 'high');
    expect(computeSla({ ...base, dueAt }, new Date('2026-10-26T09:00:00Z')).state).toBe('on_track');
    expect(computeSla({ ...base, dueAt }, new Date('2026-10-26T18:00:00Z')).state).toBe('at_risk');
    expect(computeSla({ ...base, dueAt }, new Date('2026-10-26T21:00:00Z')).state).toBe('breached');
    expect(
      computeSla({ ...base, dueAt, firstResponseAt: new Date('2026-10-26T10:00:00Z') }, new Date()).state,
    ).toBe('met');
    expect(computeSla({ ...base, priority: null, dueAt: null }, new Date()).state).toBe('pending_triage');
  });
});

describe('ticket lifecycle', () => {
  it('treats closed as terminal', () => {
    expect(allowedTransitions('closed')).toEqual([]);
    expect(() => assertTransition('closed', 'open')).toThrow(TicketLifecycleError);
  });

  it('rejects no-op transitions', () => {
    expect(() => assertTransition('open', 'open')).toThrow(/cannot move/);
  });

  it('moves open tickets to in progress when BookLeaf replies, or resolves on request', () => {
    expect(statusAfterAdminReply('open', false)).toBe('in_progress');
    expect(statusAfterAdminReply('in_progress', true)).toBe('resolved');
    expect(statusAfterAdminReply('resolved', false)).toBe('in_progress');
  });

  it('reopens a resolved ticket when the author writes again', () => {
    expect(statusAfterAuthorReply('resolved')).toEqual({ next: 'open', reopened: true });
    expect(statusAfterAuthorReply('in_progress')).toEqual({ next: 'in_progress', reopened: false });
    expect(() => statusAfterAuthorReply('closed')).toThrow(/open a new query/);
  });
});

describe('triage policy', () => {
  it('floors ISBN data errors at High (KB policy)', () => {
    const d = applyTriagePolicy(
      proposal({ category: 'isbn_metadata', priority: 'medium', signals: { ...noSignals, dataError: true } }),
      ctx,
    );
    expect(d.priority).toBe('high');
    expect(d.adjustments[0]).toMatchObject({ rule: 'isbn_error_floor', from: 'medium', to: 'high' });
    expect(d.flags).toContain('policy_adjusted');
  });

  it('escalates six months without royalty to Critical only when records confirm missed windows', () => {
    const signals = { ...noSignals, moneyOwed: true, monthsWaiting: 6 };
    const confirmed = applyTriagePolicy(
      proposal({ category: 'royalty_payments', priority: 'medium', signals }),
      { ...ctx, payoutStatus: 'attention' },
    );
    expect(confirmed.priority).toBe('critical');
    const belowMinimum = applyTriagePolicy(
      proposal({ category: 'royalty_payments', priority: 'high', signals }),
      { ...ctx, payoutStatus: 'below_threshold' },
    );
    expect(belowMinimum.priority).toBe('medium');
  });

  it('never lets a manipulated ticket auto-escalate to Critical', () => {
    const d = applyTriagePolicy(proposal({ priority: 'critical' }), { ...ctx, injectionFlagged: true });
    expect(d.priority).toBe('high');
    expect(d.flags).toEqual(expect.arrayContaining(['possible_injection', 'needs_review']));
  });

  it('flags low confidence and rule-based classifications for review', () => {
    const d = applyTriagePolicy(proposal({ confidence: 0.4 }), { ...ctx, source: 'rules' });
    expect(d.flags).toEqual(expect.arrayContaining(['low_confidence', 'rule_based', 'needs_review']));
  });

  it('only ever escalates on follow-ups', () => {
    expect(escalateOnly('high', 'low')).toBe('high');
    expect(escalateOnly('medium', 'critical')).toBe('critical');
  });
});

describe('urgency', () => {
  it('ranks by priority, then rises with age and missed deadlines', () => {
    const now = new Date('2026-10-26T12:00:00Z');
    const fresh = {
      priority: 'medium' as const,
      status: 'open' as const,
      createdAt: now,
      slaDueAt: new Date('2026-10-27T12:00:00Z'),
      firstResponseAt: null,
    };
    expect(urgencyScore(fresh, now)).toBe(40);
    const old = {
      ...fresh,
      createdAt: new Date('2026-10-24T12:00:00Z'),
      slaDueAt: new Date('2026-10-25T12:00:00Z'),
    };
    expect(urgencyScore(old, now)).toBe(40 + 8 + 8);
    expect(urgencyScore({ ...fresh, status: 'resolved' }, now)).toBe(0);
  });
});
