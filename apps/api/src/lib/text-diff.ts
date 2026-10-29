/**
 * How much a specialist changed Leaf's draft before sending: 0 = sent unchanged, 1 = rewritten.
 * Word-level Levenshtein distance normalised by the longer text — the "draft acceptance" metric.
 */
export function editRatio(draft: string, sent: string): number {
  const a = tokenize(draft);
  const b = tokenize(sent);
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0 || b.length === 0) return 1;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return Math.round((previous[b.length]! / Math.max(a.length, b.length)) * 1000) / 1000;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}
