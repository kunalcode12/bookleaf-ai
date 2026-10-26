import { KNOWLEDGE_BASE, TONE_GUIDE_SLUG } from '@bookleaf/domain';

/** Shared company context, kept identical across prompts so provider-side prefix caching can reuse it. */
export const BOOKLEAF_CONTEXT =
  'BookLeaf Publishing is a self-publishing company operating in India and the US. It handles cover design, typesetting, ISBN assignment, printing, distribution and royalty management for its authors, with an in-house printing facility and warehouse in Delhi and print partners Repro India and Epitome Books.';

export const DEFAULT_TONE_GUIDE = KNOWLEDGE_BASE.find((s) => s.slug === TONE_GUIDE_SLUG)!.body;

/** Phrases the brief calls "generic AI fluff". Listed in the prompt and re-checked on output. */
export const BANNED_PHRASES = [
  'we apologise for any inconvenience',
  'rest assured',
  'valued customer',
  'at your earliest convenience',
  'please be patient',
  'we understand your frustration',
  'do the needful',
  'kindly',
  'as per our records',
  'please do not hesitate to contact us',
];
