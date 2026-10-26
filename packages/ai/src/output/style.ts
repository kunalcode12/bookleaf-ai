import type { DraftCheck, ToneChecklist } from '@bookleaf/contracts';

interface PhraseRule {
  pattern: RegExp;
  severity: 'info' | 'warning' | 'error';
  message: string;
}

/**
 * Stock phrases that make replies sound like a generic support bot (the brief explicitly asks for
 * "not generic AI fluff"), plus things that must never reach an author.
 */
const PHRASE_RULES: readonly PhraseRule[] = [
  {
    pattern: /\bwe (sincerely )?apologi[sz]e for (any|the) inconvenience\b/i,
    severity: 'warning',
    message: 'Generic apology — name the actual problem and own it.',
  },
  {
    pattern: /\brest assured\b/i,
    severity: 'warning',
    message: 'Vague reassurance — state the concrete action instead.',
  },
  {
    pattern: /\bvalued (customer|author|client|partner)\b/i,
    severity: 'warning',
    message: 'Sounds templated — address the author by name.',
  },
  {
    pattern: /\bat your earliest convenience\b/i,
    severity: 'warning',
    message: 'Corporate filler — ask directly.',
  },
  {
    pattern: /\bplease be patient\b/i,
    severity: 'warning',
    message: 'Asks for patience instead of giving a timeline.',
  },
  {
    pattern: /\bwe understand your frustration\b/i,
    severity: 'warning',
    message: 'Generic empathy — say specifically what you understand.',
  },
  {
    pattern: /\bthank you for your (patience and understanding|understanding and patience)\b/i,
    severity: 'info',
    message: 'Common filler phrase.',
  },
  {
    pattern: /\bdo the needful\b/i,
    severity: 'warning',
    message: 'Unclear phrasing — state the exact next step.',
  },
  { pattern: /\bas per our records\b/i, severity: 'info', message: 'Prefer "our records show".' },
  { pattern: /\bkindly\b/i, severity: 'info', message: 'Slightly formal — "please" reads warmer.' },
  {
    pattern: /\bi hope (this|my) (message|email|note) finds you well\b/i,
    severity: 'info',
    message: 'Filler opener — lead with the author’s concern.',
  },
  {
    pattern: /\bplease (do not|don't) hesitate to (contact|reach out)\b/i,
    severity: 'warning',
    message: 'Generic closing — end with a concrete next step.',
  },
  {
    pattern: /\b(as an ai|as a language model|i am an ai|i'm an ai|artificial intelligence)\b/i,
    severity: 'error',
    message: 'Mentions AI — replies are sent by a BookLeaf specialist.',
  },
  {
    pattern: /(?<![A-Za-z])Leaf(?![A-Za-z])/,
    severity: 'error',
    message: 'Mentions Leaf, an internal tool — remove before sending.',
  },
];

export function phraseChecks(text: string): DraftCheck[] {
  const checks: DraftCheck[] = [];
  for (const rule of PHRASE_RULES) {
    const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`;
    const pattern = new RegExp(rule.pattern.source, flags);
    for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
      checks.push({
        kind: rule.severity === 'error' ? 'leak' : 'fluff',
        severity: rule.severity,
        message: rule.message,
        text: m[0],
        start: m.index,
        end: m.index + m[0].length,
      });
    }
  }
  return checks;
}

/** Placeholders left by the deterministic fallback template — must be filled in before sending. */
export function placeholderChecks(text: string): DraftCheck[] {
  const checks: DraftCheck[] = [];
  const pattern = /\[\[[^\]]*\]\]/g;
  for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
    checks.push({
      kind: 'placeholder',
      severity: 'error',
      message: 'Fill in this placeholder before sending.',
      text: m[0],
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return checks;
}

/** Links and contact details must come from BookLeaf policy, never be invented by a model. */
export function linkChecks(text: string, allowedDomains: readonly string[] = []): DraftCheck[] {
  const checks: DraftCheck[] = [];
  const pattern = /\bhttps?:\/\/[^\s)]+|\bwww\.[^\s)]+|[\w.+-]+@[\w-]+\.[\w.-]+/gi;
  for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
    const value = m[0];
    const host = value.includes('@')
      ? value.split('@')[1]!
      : value.replace(/^https?:\/\//i, '').split('/')[0]!;
    if (allowedDomains.some((d) => host.toLowerCase() === d || host.toLowerCase().endsWith(`.${d}`)))
      continue;
    checks.push({
      kind: 'link',
      severity: 'warning',
      message: 'Link or address not taken from BookLeaf policy — verify it before sending.',
      text: value,
      start: m.index,
      end: m.index + value.length,
    });
  }
  return checks;
}

export function lengthChecks(text: string): DraftCheck[] {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words > 260) {
    return [
      {
        kind: 'length',
        severity: 'info',
        message: `${words} words — consider trimming; replies read best under 200.`,
      },
    ];
  }
  if (words < 35) {
    return [
      {
        kind: 'length',
        severity: 'info',
        message: `${words} words — this may be too brief to address the concern.`,
      },
    ];
  }
  return [];
}

const ACKNOWLEDGE =
  /\b(sorry|apologi[sz]e|understand|thank you for|thanks for|i can see|i completely|that('s| is) (frustrating|concerning|worrying|not)|you('re| are) right|appreciate you|i hear you|completely fair|totally fair)\b/i;
const TIMELINE =
  /\bwithin\s+(the\s+next\s+)?\d+|\b\d+\s*(?:–|-|to)\s*\d+\s+(business\s+|working\s+)?(days|hours)|\bby\s+(\d{1,2}\s+[A-Z][a-z]+|[A-Z][a-z]+\s+\d{1,2})|\b(today|tomorrow|this week|end of (the )?day)\b/i;
const NEXT_STEP =
  /\b(will|we'll|i'll|we are going to|please (share|send|reply|check|confirm|let us know|review|upload|update)|next step|you can|once (we|you)|i have (escalated|raised|asked)|we have (escalated|raised|triggered))\b/i;

function bodyParagraphs(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  // Drop greeting and sign-off blocks.
  return paragraphs.filter(
    (p, i) =>
      !(i === 0 && /^(hi|hello|dear|namaste)\b[^.\n]{0,40}[,!]?$/i.test(p)) &&
      !/^(warm regards|regards|best|sincerely|thanks|thank you|with gratitude)[,!]?/i.test(p),
  );
}

/** Heuristic check of BookLeaf's tone guide. Shown as a checklist next to every draft. */
export function toneChecklist(
  text: string,
  opts: { needsEscalation: boolean; hasVerifiedFacts: boolean; bookTitle: string | null },
): ToneChecklist {
  const paragraphs = bodyParagraphs(text);
  const opening = paragraphs
    .slice(0, 1)
    .join(' ')
    .split(/(?<=[.!?])\s+/)
    .slice(0, 2)
    .join(' ');
  const closing = paragraphs.slice(-2).join(' ');
  const mentionsBook = opts.bookTitle ? text.toLowerCase().includes(opts.bookTitle.toLowerCase()) : false;
  return {
    acknowledges: ACKNOWLEDGE.test(opening),
    specific: opts.hasVerifiedFacts || mentionsBook,
    timeline: opts.needsEscalation ? TIMELINE.test(text) : true,
    nextStep: NEXT_STEP.test(closing),
    noFluff: phraseChecks(text).every((c) => c.severity === 'info'),
  };
}
