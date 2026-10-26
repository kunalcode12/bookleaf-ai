/**
 * Browser-safe entry point (`@bookleaf/ai/checks`): the deterministic draft checks the admin
 * editor runs live while a specialist edits Leaf's draft. No Node APIs, no provider code.
 */
export { type Claim, extractClaims } from './output/claims';
export { buildGroundingIndex, type CheckedClaim, groundingChecks, verifyClaims } from './output/grounding';
export { type DraftReview, type DraftReviewOptions, reviewDraft } from './output/review';
export { linkChecks, phraseChecks, placeholderChecks, toneChecklist } from './output/style';
