import type { KnowledgeSectionInput } from '../types';

const STOP_WORDS = new Set(
  'a an and are as at be but by can do does for from has have how i if in is it its me my of on or our so that the their them then there this to was we what when where which who why will with you your'.split(
    ' ',
  ),
);

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9₹\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

/** Keyword relevance over published sections, for when no model can answer. */
export function rankSectionsByKeywords(question: string, sections: KnowledgeSectionInput[], max = 2) {
  const q = new Set(terms(question));
  return sections
    .map((s) => {
      const words = terms(`${s.title} ${s.title} ${s.body}`);
      const hits = words.filter((w) => q.has(w)).length;
      return { section: s, score: hits / Math.sqrt(words.length + 1) };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((s) => s.section);
}

export function fallbackAnswer(sections: KnowledgeSectionInput[]): string {
  if (sections.length === 0) {
    return "I can't give you an instant answer right now. Please send this question to the BookLeaf team using the form below — a specialist will reply to you directly.";
  }
  const pointers = sections.map((s) => {
    const firstPoint = s.body.split('\n')[0]?.replace(/^-\s*/, '') ?? '';
    return `• ${s.title}: ${firstPoint}`;
  });
  return `I can't give you a full instant answer right now, but these BookLeaf policies look relevant:\n\n${pointers.join('\n')}\n\nIf this doesn't answer your question, send it to the BookLeaf team below and a specialist will reply to you directly.`;
}
