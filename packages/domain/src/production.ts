import { PRODUCTION_STAGE_LABELS, PRODUCTION_STAGES, type ProductionStage } from '@bookleaf/contracts';

export interface StageInfo {
  label: string;
  description: string;
  /** Where delays usually come from at this stage (from the BookLeaf knowledge base). */
  commonDelay: string | null;
  optional: boolean;
}

export const STAGE_INFO: Record<ProductionStage, StageInfo> = {
  manuscript_received: {
    label: PRODUCTION_STAGE_LABELS.manuscript_received,
    description: 'We have your manuscript and are preparing it for production.',
    commonDelay: null,
    optional: false,
  },
  editing: {
    label: PRODUCTION_STAGE_LABELS.editing,
    description: 'Professional editing, for authors who opted for it.',
    commonDelay: null,
    optional: true,
  },
  cover_design: {
    label: PRODUCTION_STAGE_LABELS.cover_design,
    description: 'Our designers create your cover and share proofs for your approval.',
    commonDelay: 'Cover Design usually waits on the author approving the cover proofs.',
    optional: false,
  },
  typesetting: {
    label: PRODUCTION_STAGE_LABELS.typesetting,
    description: 'Your manuscript is laid out for print.',
    commonDelay: null,
    optional: false,
  },
  proofreading: {
    label: PRODUCTION_STAGE_LABELS.proofreading,
    description: 'You review the typeset proofs and we apply revisions.',
    commonDelay: 'Proofreading can take longer when there are several revision rounds.',
    optional: false,
  },
  isbn_assignment: {
    label: PRODUCTION_STAGE_LABELS.isbn_assignment,
    description: 'BookLeaf assigns your unique ISBN under the BookLeaf imprint.',
    commonDelay: null,
    optional: false,
  },
  printing: {
    label: PRODUCTION_STAGE_LABELS.printing,
    description: 'Printing at our Delhi facility or a print partner (Repro India, Epitome Books).',
    commonDelay: null,
    optional: false,
  },
  distribution_setup: {
    label: PRODUCTION_STAGE_LABELS.distribution_setup,
    description:
      'We list your book on Amazon, Flipkart and the BookLeaf Store — usually live within 7–10 business days.',
    commonDelay: null,
    optional: false,
  },
  published_live: {
    label: PRODUCTION_STAGE_LABELS.published_live,
    description: 'Your book is on sale.',
    commonDelay: null,
    optional: false,
  },
};

export function isPublished(stage: ProductionStage): boolean {
  return stage === 'published_live';
}

export function stageNumber(stage: ProductionStage): number {
  return PRODUCTION_STAGES.indexOf(stage) + 1;
}

export function describeStage(stage: ProductionStage) {
  const info = STAGE_INFO[stage];
  return {
    stage,
    stageLabel: info.label,
    stepNumber: stageNumber(stage),
    totalSteps: PRODUCTION_STAGES.length,
    isPublished: isPublished(stage),
    stageDescription: info.description,
    commonDelay: info.commonDelay,
  };
}

/**
 * Maps the dataset's human status strings ("Published & Live", "In Production - Cover Design")
 * onto the normalized stage enum. Throws on anything unknown so bad data fails the seed loudly.
 */
export function parseStageLabel(status: string): ProductionStage {
  const normalized = status
    .replace(/^in production\s*[-–—:]\s*/i, '')
    .trim()
    .toLowerCase();
  for (const stage of PRODUCTION_STAGES) {
    if (PRODUCTION_STAGE_LABELS[stage].toLowerCase() === normalized) return stage;
  }
  throw new RangeError(`Unknown production status: "${status}"`);
}
