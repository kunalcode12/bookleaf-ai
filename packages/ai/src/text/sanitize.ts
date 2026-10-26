/**
 * Normalises untrusted author text before it reaches a model.
 *
 * - NFKC folds look-alike characters ("ｉｇｎｏｒｅ" → "ignore") so pattern checks see real words.
 * - Strips characters that are invisible to a human reviewer but readable by a model: Unicode tag
 *   characters (ASCII smuggling), bidi overrides/isolates ("Trojan Source"), zero-width spaces and
 *   other fillers. ZWJ/ZWNJ are kept because Hindi, Malayalam and other Indic scripts need them.
 * - Removes control characters and collapses runaway whitespace.
 *
 * Only the copy sent to the model is sanitised; the stored ticket keeps the author's exact words.
 * (All invisible characters below are written as escapes on purpose — never as literals.)
 */

const TAG_CHARACTERS = /[\u{E0000}-\u{E007F}]/gu;
const BIDI_CONTROLS = /[\u{202A}-\u{202E}\u{2066}-\u{2069}\u{200E}\u{200F}\u{061C}]/gu;
// U+034F (combining grapheme joiner) sits outside the class: a combining mark inside a class is ambiguous.
const INVISIBLE_FILLERS =
  /[\u{200B}\u{2060}-\u{2064}\u{FEFF}\u{00AD}\u{115F}\u{1160}\u{17B4}\u{17B5}\u{180E}\u{3164}\u{FFA0}]|\u{034F}/gu;
const VARIATION_SELECTORS = /[\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]/gu;
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point.
const CONTROL_CHARACTERS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;

export interface SanitizeResult {
  text: string;
  /** Count of hidden characters removed — a manipulation signal in its own right. */
  hiddenCharacters: number;
  truncated: boolean;
}

function strip(text: string, pattern: RegExp): [string, number] {
  let count = 0;
  const out = text.replace(pattern, () => {
    count += 1;
    return '';
  });
  return [out, count];
}

export function sanitizeUntrusted(input: string, maxChars: number): SanitizeResult {
  let text = input.normalize('NFKC');
  let hidden = 0;
  for (const pattern of [TAG_CHARACTERS, BIDI_CONTROLS, INVISIBLE_FILLERS, VARIATION_SELECTORS]) {
    const [next, removed] = strip(text, pattern);
    text = next;
    hidden += removed;
  }
  text = text
    .replace(CONTROL_CHARACTERS, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{3,}/g, '  ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();

  let truncated = false;
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)} …[truncated]`;
    truncated = true;
  }
  return { text, hiddenCharacters: hidden, truncated };
}

/**
 * Neutralises angle brackets so untrusted text can never open or close the XML-style sections
 * Leaf's prompts are built from (e.g. a fake `</ticket_x>`). Visually identical to a reader.
 */
export function neutralizeMarkup(text: string): string {
  return text.replaceAll('<', '‹').replaceAll('>', '›');
}
