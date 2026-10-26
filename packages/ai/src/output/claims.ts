import type { ClaimKind } from '@bookleaf/contracts';

/** A checkable statement found in text: an amount, a date, a duration… with its normalised value. */
export interface Claim {
  kind: ClaimKind;
  text: string;
  /** Canonical form used for comparison (paise for amounts, ISO for dates, "5-7 business days"). */
  value: string;
  start: number;
  end: number;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const MONTH_NAME =
  '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

const pad = (n: number) => String(n).padStart(2, '0');
const monthOf = (name: string) => MONTHS[name.slice(0, 3).toLowerCase()] ?? 0;

function isoDate(year: string | undefined, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return year ? `${year}-${pad(month)}-${pad(day)}` : `--${pad(month)}-${pad(day)}`;
}

function amountValue(whole: string, fraction: string | undefined): string {
  const rupees = Number(whole.replaceAll(',', ''));
  const paise = fraction ? Number(fraction.padEnd(2, '0')) : 0;
  return String(rupees * 100 + paise);
}

function unitOf(raw: string): string {
  const u = raw.toLowerCase().replace(/\s+/g, ' ');
  if (u.startsWith('working') || u.startsWith('business')) return 'business days';
  if (u.startsWith('hour')) return 'hours';
  if (u.startsWith('week')) return 'weeks';
  if (u.startsWith('month')) return 'months';
  return 'days';
}

interface Extractor {
  kind: ClaimKind | 'skip';
  pattern: RegExp;
  value: (m: RegExpExecArray) => string | null;
}

// Order matters: specific shapes claim their span first so "₹1,000" is not also read as a number.
const EXTRACTORS: Extractor[] = [
  // Ticket references are identifiers, not claims.
  { kind: 'skip', pattern: /\bBL-\d+\b/gi, value: () => null },
  // Placeholders like [EMAIL] / [[ fill in ]] are not claims either.
  { kind: 'skip', pattern: /\[\[[^\]]*\]\]|\[[A-Z_]{3,}\]/g, value: () => null },
  {
    kind: 'isbn',
    pattern: /\b97[89](?:[-\s]?[\dX]){10}\b/gi,
    value: (m) => m[0].replace(/[^\dX]/gi, '').toUpperCase(),
  },
  {
    kind: 'amount',
    pattern: /(?:₹|\bRs\.?|\bINR)\s?(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?/gi,
    value: (m) => amountValue(m[1]!, m[2]),
  },
  {
    kind: 'amount',
    pattern: /\b(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?\s?(?:rupees|INR)\b/gi,
    value: (m) => amountValue(m[1]!, m[2]),
  },
  {
    kind: 'date',
    pattern: new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_NAME}\\.?(?:,?\\s+(\\d{4}))?\\b`,
      'gi',
    ),
    value: (m) => isoDate(m[3], monthOf(m[2]!), Number(m[1])),
  },
  {
    kind: 'date',
    pattern: new RegExp(`\\b${MONTH_NAME}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'gi'),
    value: (m) => isoDate(m[3], monthOf(m[1]!), Number(m[2])),
  },
  {
    kind: 'date',
    pattern: /\b(\d{4})-(\d{2})-(\d{2})\b/g,
    value: (m) => isoDate(m[1], Number(m[2]), Number(m[3])),
  },
  {
    kind: 'date',
    pattern: /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g,
    value: (m) => isoDate(m[3], Number(m[2]), Number(m[1])),
  },
  {
    kind: 'duration',
    pattern:
      /\b(\d+)\s*(?:–|-|—|to)\s*(\d+)\s+(business days?|working days?|days?|hours?|weeks?|months?)\b/gi,
    value: (m) => `${m[1]}-${m[2]} ${unitOf(m[3]!)}`,
  },
  {
    kind: 'duration',
    pattern: /\b(\d+)[\s-](business days?|working days?|days?|hours?|weeks?|months?)\b/gi,
    value: (m) => `${m[1]} ${unitOf(m[2]!)}`,
  },
  {
    kind: 'percent',
    pattern: /\b(\d{1,2})\s?\/\s?(\d{1,2})\s+(?:royalty\s+)?split\b/gi,
    value: (m) => `${m[1]}/${m[2]}`,
  },
  {
    kind: 'percent',
    pattern: /\b(\d{1,3}(?:\.\d+)?)\s?(?:%|percent\b)/gi,
    value: (m) => String(Number(m[1])),
  },
  {
    kind: 'number',
    pattern: /\b\d{1,3}(?:,\d{2,3})+\b|\b\d{2,}\b/g,
    value: (m) => {
      const n = m[0].replaceAll(',', '');
      // Small counts ("3 weeks", "2 copies") are noise, not facts worth checking.
      return Number(n) >= 10 ? n : null;
    },
  },
];

export function extractClaims(text: string): Claim[] {
  const claims: Claim[] = [];
  const taken: Array<[number, number]> = [];
  const overlaps = (s: number, e: number) => taken.some(([a, b]) => s < b && e > a);

  for (const extractor of EXTRACTORS) {
    extractor.pattern.lastIndex = 0;
    for (let m = extractor.pattern.exec(text); m !== null; m = extractor.pattern.exec(text)) {
      const start = m.index;
      const end = start + m[0].length;
      if (m[0].length === 0) {
        extractor.pattern.lastIndex += 1;
        continue;
      }
      if (overlaps(start, end)) continue;
      taken.push([start, end]);
      if (extractor.kind === 'skip') continue;
      const value = extractor.value(m);
      if (value !== null) claims.push({ kind: extractor.kind, text: m[0], value, start, end });
    }
  }
  return claims.sort((a, b) => a.start - b.start);
}
