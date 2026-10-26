/**
 * Masks personal and financial identifiers before text is sent to a third-party model.
 * Authors sometimes paste bank details or ID numbers into tickets; Leaf never needs them to
 * classify or draft a reply, so they are replaced with typed placeholders.
 */

export type PiiKind = 'card' | 'aadhaar' | 'ifsc' | 'pan' | 'upi' | 'email' | 'phone' | 'bank_account';

export interface RedactionResult {
  text: string;
  redactions: Partial<Record<PiiKind, number>>;
  total: number;
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const looksLikeIsbn = (digits: string) => digits.length === 13 && /^97[89]/.test(digits);

interface Rule {
  kind: PiiKind;
  pattern: RegExp;
  accept?: (match: string) => boolean;
}

// Order matters: the most specific shapes run first so a card number is not mistaken for a
// bank account, and UPI handles are caught before generic emails.
const RULES: Rule[] = [
  {
    kind: 'card',
    pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
    accept: (m) => {
      const digits = m.replace(/\D/g, '');
      return digits.length >= 13 && digits.length <= 19 && !looksLikeIsbn(digits) && luhnValid(digits);
    },
  },
  { kind: 'aadhaar', pattern: /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g },
  { kind: 'ifsc', pattern: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g },
  { kind: 'pan', pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  {
    kind: 'upi',
    pattern: /\b[\w.-]{2,}@(?:ok)?[a-z]{2,}\b(?!\.)/gi,
    accept: (m) => !m.split('@')[1]!.includes('.'),
  },
  { kind: 'email', pattern: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g },
  {
    kind: 'phone',
    pattern: /(?:\+\d{1,3}[ -]?)?(?:\(?\d{2,5}\)?[ -]?)?\d{3,5}[ -]?\d{4,5}\b/g,
    accept: (m) => {
      const digits = m.replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 13 || looksLikeIsbn(digits)) return false;
      // Indian mobile numbers, or anything written with an international prefix.
      return /^(?:91)?[6-9]\d{9}$/.test(digits) || m.trim().startsWith('+');
    },
  },
  {
    kind: 'bank_account',
    pattern: /\b\d{9,18}\b/g,
    accept: (m) => !looksLikeIsbn(m),
  },
];

const PLACEHOLDER: Record<PiiKind, string> = {
  card: '[CARD_NUMBER]',
  aadhaar: '[AADHAAR_NUMBER]',
  ifsc: '[IFSC_CODE]',
  pan: '[PAN_NUMBER]',
  upi: '[UPI_ID]',
  email: '[EMAIL]',
  phone: '[PHONE]',
  bank_account: '[BANK_ACCOUNT_NUMBER]',
};

export function redactPii(input: string): RedactionResult {
  let text = input;
  const redactions: Partial<Record<PiiKind, number>> = {};
  let total = 0;
  for (const rule of RULES) {
    text = text.replace(rule.pattern, (match) => {
      if (rule.accept && !rule.accept(match)) return match;
      redactions[rule.kind] = (redactions[rule.kind] ?? 0) + 1;
      total += 1;
      return PLACEHOLDER[rule.kind];
    });
  }
  return { text, redactions, total };
}
