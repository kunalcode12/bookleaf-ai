/**
 * Fast token estimate for budgeting (no tokenizer dependency). English averages ~4 characters per
 * token; Indic scripts and other non-ASCII text tokenize far denser, so they are weighted heavier.
 * Real usage always comes from the provider's response — this is only for planning and baselines.
 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) < 128) ascii += 1;
    else other += 1;
  }
  return Math.ceil(ascii / 4 + other / 1.6);
}

/** Cuts text to roughly `maxTokens`, on a word boundary, marking the cut. */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  let end = Math.max(0, Math.floor(maxTokens * 3.6));
  while (end > 0 && estimateTokens(text.slice(0, end)) > maxTokens) end = Math.floor(end * 0.9);
  const cut = text.slice(0, end);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > end * 0.8 ? cut.slice(0, lastSpace) : cut} …`;
}
