import {
  type ProductionStage,
  type Sentiment,
  TICKET_CATEGORY_LABELS,
  type TicketCategory,
  type TicketPriority,
  type TriageSignals,
} from '@bookleaf/contracts';

type WeightedPattern = readonly [RegExp, number];

const CATEGORY_PATTERNS: Record<TicketCategory, readonly WeightedPattern[]> = {
  royalty_payments: [
    [/\broyalt(y|ies)\b/i, 3],
    [/\bpay ?outs?\b|\bpaid\b|\bpayments?\b/i, 2],
    [/\bbank\b|\bneft\b|\bimps\b|\btransfer\b/i, 1.5],
    [/₹|\brs\.?\s?\d|\brupees\b|\binr\b/i, 1],
    [/\bearn(ed|ings)?\b|\bstatement\b|\bbreakdown\b/i, 1.5],
    [/\bnet profit\b|\b80\s?\/\s?20\b|\bcommission\b/i, 1.5],
  ],
  isbn_metadata: [
    [/\bisbn\b/i, 4],
    [/\bmetadata\b|\bimprint\b|\bbarcode\b/i, 2],
    [
      /\bwrong (book|title|author|name|price|isbn)\b|\bmismatch|\bduplicate\b|\bdifferent (isbn|title|book|author)\b/i,
      2.5,
    ],
    [/\b(misspel|incorrect|wrong)\w*\b.{0,30}\b(name|title|author)\b/i, 1.5],
    [/\b(name|title|spelling)\b.{0,30}\b(misspel\w*|misspelt|typo|spelt wrong|spelled wrong)/i, 2.5],
    [/\b(book )?description\b|\bblurb\b|\bauthor bio\b/i, 1],
  ],
  printing_quality: [
    [/\bprint(ing|ed)?\b/i, 1.5],
    [/\bmisprint\w*|\bblurr?y\b|\bmisaligned\b|\bsmudg\w*|\bfaded\b/i, 3],
    [/\bbinding\b|\bpages? (are )?(falling|loose|missing|torn|upside)|\bspine\b/i, 2.5],
    [/\bcolou?rs?\b.{0,20}\b(off|wrong|inconsistent|dull)\b/i, 2],
    [/\bquality\b|\bdefect\w*|\bdamaged?\b|\breprint\b/i, 2],
    [/\bauthor copies\b|\bcopies (arrived|received|came)\b/i, 1.5],
  ],
  distribution_availability: [
    [/\bamazon\b|\bflipkart\b|\bbookleaf store\b/i, 2],
    [
      /\bunavailable\b|\bout of stock\b|\bnot (available|showing|listed|visible|live)\b|\bcan'?t (find|buy)\b/i,
      3,
    ],
    [/\blisting\b|\blisted\b|\bstock\b|\bdistribution\b/i, 1.5],
    [/\bgo(es|ing)? live\b|\blive on\b/i, 1],
  ],
  book_status_production: [
    [/\btypesetting\b|\bproofread\w*|\bcover design\b|\bediting\b|\bmanuscript\b/i, 3],
    [/\bproduction\b|\bstage\b|\bstatus\b/i, 1.5],
    [/\bdelay\w*|\bstill (in|not|waiting)\b|\bwhen will\b|\bhow long\b|\btimeline\b/i, 1.5],
    [/\bproofs?\b|\bapprov(e|al)\b|\blaunch\b|\brelease date\b/i, 1.5],
  ],
  general_inquiry: [
    [/\bbio\b|\bprofile\b|\baccount\b|\bpassword\b|\blog ?in\b/i, 2],
    [/\bpackage\b|\bbestseller breakthrough\b|\bstandard free\b|\bcontract\b/i, 2],
    [/\bhow (do|can) i\b|\bcan i\b|\bis it possible\b/i, 1],
    [/\bupdate (my|the) (bio|description|blurb|photo|picture)\b/i, 2.5],
  ],
};

const BASE_PRIORITY: Record<TicketCategory, TicketPriority> = {
  royalty_payments: 'medium',
  isbn_metadata: 'medium',
  printing_quality: 'medium',
  distribution_availability: 'medium',
  book_status_production: 'medium',
  general_inquiry: 'low',
};

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

function monthsWaiting(text: string): number | null {
  const match =
    /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+months?\b/i.exec(text);
  if (match) {
    const raw = match[1]!.toLowerCase();
    return WORD_NUMBERS[raw] ?? Number(raw);
  }
  if (/\b(a|one) year\b|\bover a year\b|\b12 months\b/i.test(text)) return 12;
  return null;
}

export interface RulesClassification {
  category: TicketCategory;
  priority: TicketPriority;
  confidence: number;
  signals: TriageSignals;
  sentiment: Sentiment;
  summary: string;
  rationale: string;
}

/**
 * Deterministic keyword classifier used when no AI provider is reachable. Accuracy is lower than
 * the LLM's (see the eval report), so its output is always flagged for review — but the queue
 * keeps working and the most important rules (legal threats, ISBN errors…) still apply.
 */
export function classifyByRules(input: {
  subject: string;
  description: string;
  bookStage: ProductionStage | null;
}): RulesClassification {
  const text = `${input.subject}\n${input.description}`;
  const scores = Object.entries(CATEGORY_PATTERNS).map(([category, patterns]) => {
    let score = 0;
    for (const [pattern, weight] of patterns) if (pattern.test(text)) score += weight;
    if (category === 'book_status_production' && input.bookStage && input.bookStage !== 'published_live')
      score += 1;
    return { category: category as TicketCategory, score };
  });
  scores.sort((a, b) => b.score - a.score);
  const top = scores[0]!;
  const second = scores[1]!;
  const category: TicketCategory = top.score >= 2 ? top.category : 'general_inquiry';
  const confidence =
    top.score >= 2 ? Math.min(0.6, 0.3 + ((top.score - second.score) / (top.score + 1)) * 0.6) : 0.3;

  const signals: TriageSignals = {
    moneyOwed:
      /\b(not (been )?(received|paid)|haven'?t (got|received|been paid)|missing|owed|unpaid|no (royalty|payment|payout))\b/i.test(
        text,
      ),
    monthsWaiting: monthsWaiting(text),
    dataError:
      /\bisbn\b.{0,60}\b(wrong|different|mismatch|duplicate|incorrect)|\b(wrong|different|duplicate|incorrect)\b.{0,40}\bisbn\b|\bwrong book\b/i.test(
        text,
      ),
    printDefect:
      /\bmisprint\w*|\bblurr?y\b|\bmisaligned\b|\bbinding\b|\bsmudg\w*|\bdefect\w*|\bdamaged\b|\bpages? (are )?(falling|loose|missing|torn)|\bupside[- ]down\b|\bprinted (wrong|incorrectly|backwards)/i.test(
        text,
      ),
    platformUnavailable:
      /\bunavailable\b|\bout of stock\b|\bnot (available|showing|listed|visible)\b|\bcan'?t (find|buy)\b/i.test(
        text,
      ),
    productionDelay:
      /\bdelay\w*|\bstill (in|not|waiting)\b|\b(weeks?|months?)\b.{0,30}\bstill\b|\btaking (too )?long\b/i.test(
        text,
      ),
    legalThreat:
      /\blawyer\b|\badvocate\b|\blegal (action|notice)\b|\bcourt\b|\bconsumer (forum|court|complaint)\b|\bpolice\b|\bfir\b|\bfraud\b|\bscam\b|\bcheat(ed|ing)?\b|\bsue\b/i.test(
        text,
      ),
    manipulationAttempt: false,
  };

  let priority = BASE_PRIORITY[category];
  const raise = (p: TicketPriority) => {
    const rank = { critical: 0, high: 1, medium: 2, low: 3 };
    if (rank[p] < rank[priority]) priority = p;
  };
  if (signals.dataError || signals.printDefect || signals.platformUnavailable) raise('high');
  if (signals.moneyOwed && (signals.monthsWaiting ?? 0) >= 3) raise('high');
  if (signals.moneyOwed && (signals.monthsWaiting ?? 0) >= 6) raise('critical');
  if (signals.legalThreat) raise('critical');

  const sentiment: Sentiment =
    /\bfurious\b|\bangry\b|\bworst\b|\bscam\b|\bcheat\w*|\bfraud\b|\bunacceptable\b|\bdisgust\w*/i.test(text)
      ? 'angry'
      : /\bfrustrat\w*|\bdisappoint\w*|\bterrible\b|\bridiculous\b|\bagain\b|\bstill\b|\bwhy (haven'?t|has|is)\b/i.test(
            text,
          )
        ? 'frustrated'
        : /\bworried\b|\bconcern\w*|\bconfus\w*|\bnot sure\b/i.test(text)
          ? 'concerned'
          : 'calm';

  const subject = input.subject.trim().replace(/\s+/g, ' ');
  return {
    category,
    priority,
    confidence: Math.round(confidence * 100) / 100,
    signals,
    sentiment,
    summary: `${TICKET_CATEGORY_LABELS[category]}: ${subject.length > 90 ? `${subject.slice(0, 87)}…` : subject}`,
    rationale:
      top.score >= 2
        ? `Keyword rules matched ${TICKET_CATEGORY_LABELS[category]}. Leaf's AI models were unavailable, so please confirm the category and priority.`
        : "No strong keyword match. Leaf's AI models were unavailable, so please review this ticket manually.",
  };
}
