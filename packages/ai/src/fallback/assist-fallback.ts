import type { KnowledgeSectionInput } from '../types';

const STOP_WORDS = new Set(
  'a an and are as at be but by can do does for from get got has have how i if in is it its me my of on or our so that the their them then there this to was we what when where which who why will with you your'.split(
    ' ',
  ),
);

/** Crude stemming so "royalties"/"royalty" and "paid"/"payment" meet. */
function stem(word: string): string {
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
  return word;
}

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9₹\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t))
    .map(stem);
}

/** What kind of answer the question wants, mapped to the policy lines that carry it. */
const INTENTS: ReadonlyArray<{ question: RegExp; line: RegExp }> = [
  // "When will I be paid?" → timing and thresholds, not how the split works.
  {
    question: /\b(when|receive|received|get|paid|payout|pay|transfer|bank)\b/i,
    line: /\b(paid|payouts?|quarter\w*|within|threshold|roll|bank)\b/i,
  },
  {
    question: /\b(low|less|calculat\w*|how much|amount|split|percent|share|net)\b/i,
    line: /\b(split|net profit|mrp|commission|80)\b/i,
  },
  {
    question: /\b(how long|time|days|weeks|soon|live)\b/i,
    line: /\b(days|weeks|within|turnaround|go live)\b/i,
  },
];

/** Keyword relevance over published sections, for when no model can answer. */
export function rankSectionsByKeywords(question: string, sections: KnowledgeSectionInput[], max = 2) {
  const q = new Set(terms(question));
  const ranked = sections
    .map((s) => {
      const words = terms(`${s.title} ${s.title} ${s.body}`);
      const hits = words.filter((w) => q.has(w)).length;
      return { section: s, score: hits / Math.sqrt(words.length + 1) };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  const top = ranked[0]?.score ?? 0;
  // A weak second match ("royalty" in the company overview) only adds noise.
  return ranked
    .filter((s) => s.score >= top * 0.6)
    .slice(0, max)
    .map((s) => s.section);
}

/** The one or two policy lines in a section that best answer the question, in document order. */
export function relevantLines(question: string, section: KnowledgeSectionInput, max = 2): string[] {
  const q = new Set(terms(question));
  const intents = INTENTS.filter((i) => i.question.test(question));
  const lines = section.body
    .split('\n')
    .map((l) => l.replace(/^-\s*/, '').trim())
    .filter(Boolean);
  const scored = lines.map((line, index) => {
    const overlap = terms(line).filter((w) => q.has(w)).length;
    const intent = intents.some((i) => i.line.test(line)) ? 2 : 0;
    return { line, index, score: overlap + intent };
  });
  const best = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, max)
    .sort((a, b) => a.index - b.index)
    .map((s) => s.line);
  return best.length > 0 ? best : lines.slice(0, 1);
}

export function fallbackAnswer(question: string, sections: KnowledgeSectionInput[]): string {
  if (sections.length === 0) {
    return "I can't give you an instant answer right now. Please send this question to the BookLeaf team using the form below, and a specialist will reply to you directly.";
  }
  const pointers = sections.flatMap((s) => relevantLines(question, s).map((line) => `• ${line}`));
  return `I can't give you a full answer right now, but here is what BookLeaf's policy says:\n\n${pointers.join('\n')}\n\nIf that doesn't settle it, send your question to the BookLeaf team below and a specialist will reply to you directly.`;
}
