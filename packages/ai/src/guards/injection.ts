/**
 * Heuristic prompt-injection detector (layer 1 of Leaf's defence). Fast, deterministic and
 * explainable: each matched pattern is reported by id so admins can see *why* a ticket was
 * flagged. Combined with the Prompt Guard 2 classifier (layer 2) and the model's own
 * `manipulationAttempt` signal (layer 3). Flagging never blocks a ticket — it raises review
 * and stops automatic escalation.
 */

interface InjectionPattern {
  id: string;
  weight: number;
  pattern: RegExp;
}

const PATTERNS: readonly InjectionPattern[] = [
  {
    id: 'ignore_instructions',
    weight: 0.85,
    pattern:
      /\b(ignore|disregard|forget|override|bypass|skip)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|the|your|these|system|safety)\b[^.\n]{0,30}\b(instructions?|prompts?|rules?|directions?|guidelines?|messages?|context|policies)\b/i,
  },
  {
    // Hindi word order puts the verb last: "pichle instructions ignore karo".
    id: 'ignore_instructions_hinglish',
    weight: 0.75,
    pattern:
      /\b(nirdesh|instructions?|rules?|niyam)\b[^.\n]{0,30}\b(ignore|bhool|bhul)\w*\b[^.\n]{0,10}\b(karo|kar do|jao|do)\b|\b(ignore|bhool|bhul)\b[^.\n]{0,30}\b(nirdesh|instructions?|rules?|niyam)\b[^.\n]{0,15}\b(karo|kar do|jao)\b/i,
  },
  {
    id: 'priority_manipulation_hinglish',
    weight: 0.55,
    pattern:
      /\b(critical|urgent|top priority)\b[^.\n]{0,20}\b(mark|set)\b[^.\n]{0,10}\b(karo|kar do|kijiye)\b/i,
  },
  {
    id: 'new_instructions',
    weight: 0.55,
    pattern:
      /\b(new|updated|real|actual|hidden|secret|override)\s+(instructions?|rules?|system\s+prompt|directives?)\b/i,
  },
  {
    id: 'role_override',
    weight: 0.6,
    pattern:
      /\b(you are now|from now on,? you|act as (a|an|the)|pretend (to be|you are)|roleplay as|you must now|switch (to|into) .{0,20}mode)\b/i,
  },
  {
    id: 'system_prompt_probe',
    weight: 0.7,
    pattern:
      /\b(reveal|show|print|repeat|output|display|tell me|leak|dump)\b[^.\n]{0,40}\b(system prompt|your instructions|hidden prompt|initial prompt|developer message|your rules|internal (notes|instructions)|the prompt)\b/i,
  },
  {
    id: 'role_tag',
    weight: 0.7,
    pattern:
      /<\/?\s*(system|assistant|user|developer|instructions?|ticket[\w-]*|thread[\w-]*|facts|policies|tool|admin)\b[^>]*>/i,
  },
  {
    id: 'chat_markup',
    weight: 0.8,
    pattern: /<\|[a-z_]+\|>|\[\/?(INST|SYS)\]|<<\/?SYS>>|^\s*#{2,}\s*(system|instructions?)\b/im,
  },
  { id: 'speaker_label', weight: 0.5, pattern: /^\s*(system|assistant|developer|admin)\s*:/im },
  {
    id: 'priority_manipulation',
    weight: 0.55,
    pattern:
      /\b(mark|set|classify|label|flag|escalate|categori[sz]e|treat|rate|make)\b[^.\n]{0,30}\b(this|the ticket|it|me|my (ticket|query|request))\b[^.\n]{0,30}\b(critical|urgent|top priority|highest priority|priority\s*(1|one|zero|p0))\b/i,
  },
  {
    id: 'jailbreak_terms',
    weight: 0.75,
    pattern: /\b(DAN|developer mode|jailbreak|do anything now|no restrictions|unfiltered mode|god mode)\b/i,
  },
  { id: 'encoded_payload', weight: 0.35, pattern: /[A-Za-z0-9+/]{120,}={0,2}/ },
  { id: 'markdown_exfiltration', weight: 0.6, pattern: /!\[[^\]]*\]\(\s*https?:\/\/[^)]+\)/i },
  {
    id: 'reply_hijack',
    weight: 0.6,
    pattern:
      /\b(in your (reply|response|answer)|reply with|respond with|your response must)\b[^.\n]{0,60}\b(only|exactly|the words?|the following|refund|compensation|approved)\b|\b(reply|respond|answer)\b[^.\n]{0,15}\b(only|exactly|just)\b[^.\n]{0,20}\b(with|the words?|saying)\b/i,
  },
  {
    // Text shaped like Leaf's own output schema, trying to pre-fill the classification.
    id: 'schema_spoofing',
    weight: 0.65,
    pattern:
      /"(category|priority|secondaryCategory|signals|manipulationAttempt|confidence)"\s*:\s*["{\d]|\buse (this|these) (exact )?(classification|labels?|category|priority)\b/i,
  },
];

export interface InjectionScan {
  score: number;
  signals: string[];
}

/** Noisy-OR combination: independent weak signals add up, one strong signal dominates. */
export function scanForInjection(text: string, opts: { hiddenCharacters?: number } = {}): InjectionScan {
  const signals: string[] = [];
  let notInjected = 1;
  for (const { id, weight, pattern } of PATTERNS) {
    if (pattern.test(text)) {
      signals.push(id);
      notInjected *= 1 - weight;
    }
  }
  if ((opts.hiddenCharacters ?? 0) > 0) {
    signals.push('hidden_characters');
    notInjected *= 1 - Math.min(0.7, 0.35 + 0.05 * (opts.hiddenCharacters ?? 0));
  }
  return { score: Math.round((1 - notInjected) * 1000) / 1000, signals };
}

export const HEURISTIC_FLAG_THRESHOLD = 0.5;
export const MODEL_FLAG_THRESHOLD = 0.85;
