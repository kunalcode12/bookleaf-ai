import type { ClaimKind, DraftCheck, GroundingIndex } from '@bookleaf/contracts';
import { type Claim, extractClaims } from './claims';

export interface GroundingSources {
  facts: Array<{ id: string; label: string; text: string }>;
  policies: Array<{ slug: string; body: string }>;
  /** The author's own words — numbers they quote are "quoted", not invented. */
  authorTexts: string[];
}

/** Collects every value a reply may state, with its provenance. Shipped to the editor with drafts. */
export function buildGroundingIndex(sources: GroundingSources): GroundingIndex {
  const allowed = new Map<string, { kind: ClaimKind; value: string; source: string }>();
  const add = (kind: ClaimKind, value: string, source: string) => {
    const key = `${kind}:${value}`;
    if (!allowed.has(key)) allowed.set(key, { kind, value, source });
  };
  const addAll = (text: string, source: string) => {
    for (const claim of extractClaims(text)) {
      add(claim.kind, claim.value, source);
      if (claim.kind === 'date' && /^\d{4}-/.test(claim.value)) {
        // A fact dated 14 Nov 2026 also licenses "14 November" and the year on its own.
        add('date', `--${claim.value.slice(5)}`, source);
        add('number', claim.value.slice(0, 4), source);
      }
      if (claim.kind === 'amount') add('number', String(Number(claim.value) / 100), source);
    }
  };
  for (const fact of sources.facts) addAll(fact.text, fact.id);
  for (const policy of sources.policies) addAll(policy.body, `policy:${policy.slug}`);
  for (const text of sources.authorTexts) addAll(text, 'author');
  return {
    facts: sources.facts.map(({ id, label, text }) => ({ id, label, text })),
    allowed: [...allowed.values()],
  };
}

export type ClaimStatus = 'verified' | 'quoted' | 'unverified';

export interface CheckedClaim extends Claim {
  status: ClaimStatus;
  source: string | null;
}

export function verifyClaims(text: string, index: GroundingIndex): CheckedClaim[] {
  const lookup = new Map(index.allowed.map((a) => [`${a.kind}:${a.value}`, a.source]));
  return extractClaims(text).map((claim) => {
    let source = lookup.get(`${claim.kind}:${claim.value}`) ?? null;
    // "3570" written without the ₹ sign still verifies against the ₹3,570 fact.
    if (!source && claim.kind === 'number')
      source = lookup.get(`amount:${Number(claim.value) * 100}`) ?? null;
    const status: ClaimStatus = source === null ? 'unverified' : source === 'author' ? 'quoted' : 'verified';
    return { ...claim, status, source };
  });
}

const KIND_LABEL: Record<ClaimKind, string> = {
  amount: 'Amount',
  date: 'Date',
  number: 'Number',
  percent: 'Percentage',
  duration: 'Timeline',
  isbn: 'ISBN',
};

export function groundingChecks(text: string, index: GroundingIndex): DraftCheck[] {
  return verifyClaims(text, index).map((claim) => {
    const base = { kind: 'fact' as const, text: claim.text, start: claim.start, end: claim.end };
    if (claim.status === 'verified') {
      const fact = index.facts.find((f) => f.id === claim.source);
      return {
        ...base,
        severity: 'ok' as const,
        message: `${KIND_LABEL[claim.kind]} verified${fact ? ` against ${fact.label}` : claim.source?.startsWith('policy:') ? ' against BookLeaf policy' : ''}.`,
        source: claim.source ?? undefined,
      };
    }
    if (claim.status === 'quoted') {
      return {
        ...base,
        severity: 'info' as const,
        message: `${KIND_LABEL[claim.kind]} quoted from the author's message, not from BookLeaf records.`,
        source: 'author',
      };
    }
    return {
      ...base,
      severity: 'warning' as const,
      message: `${KIND_LABEL[claim.kind]} "${claim.text}" does not match BookLeaf's records or policies — check it before sending.`,
    };
  });
}
