import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema, PersonRefSchema } from './common';
import {
  AI_FLAGS,
  AI_JOB_STATUSES,
  AI_PROVIDER_IDS,
  AI_TASKS,
  CLASSIFICATION_SOURCES,
  DRAFT_ORIGINS,
  DRAFT_STATUSES,
  ESCALATION_TEAMS,
  REFINE_PRESETS,
  SENTIMENTS,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
} from './enums';
import { LIMITS } from './limits';

export const PolicyAdjustmentSchema = z.object({
  rule: z.string(),
  field: z.enum(['priority', 'category', 'flags']),
  from: z.string().nullable(),
  to: z.string(),
  reason: z.string(),
});
export type PolicyAdjustment = z.infer<typeof PolicyAdjustmentSchema>;

export const TriageSignalsSchema = z.object({
  moneyOwed: z.boolean(),
  monthsWaiting: z.number().nullable(),
  dataError: z.boolean(),
  printDefect: z.boolean(),
  platformUnavailable: z.boolean(),
  productionDelay: z.boolean(),
  legalThreat: z.boolean(),
  manipulationAttempt: z.boolean(),
});
export type TriageSignals = z.infer<typeof TriageSignalsSchema>;

export const InjectionReportSchema = z.object({
  flagged: z.boolean(),
  score: z.number(),
  signals: z.array(z.string()),
  modelScore: z.number().nullable(),
});
export type InjectionReport = z.infer<typeof InjectionReportSchema>;

export const TriageViewSchema = z
  .object({
    status: z.enum(AI_JOB_STATUSES),
    category: z.enum(TICKET_CATEGORIES).nullable(),
    categorySource: z.enum(CLASSIFICATION_SOURCES).nullable(),
    secondaryCategory: z.enum(TICKET_CATEGORIES).nullable(),
    priority: z.enum(TICKET_PRIORITIES).nullable(),
    prioritySource: z.enum(CLASSIFICATION_SOURCES).nullable(),
    /** What Leaf originally proposed — kept so overrides stay auditable. */
    aiCategory: z.enum(TICKET_CATEGORIES).nullable(),
    aiPriority: z.enum(TICKET_PRIORITIES).nullable(),
    confidence: z.number().nullable(),
    summary: z.string().nullable(),
    rationale: z.string().nullable(),
    sentiment: z.enum(SENTIMENTS).nullable(),
    language: z.string().nullable(),
    signals: TriageSignalsSchema.nullable(),
    policyAdjustments: z.array(PolicyAdjustmentSchema),
    flags: z.array(z.enum(AI_FLAGS)),
    injection: InjectionReportSchema.nullable(),
    provider: z.string().nullable(),
    model: z.string().nullable(),
    error: z.string().nullable(),
    triagedAt: IsoDateTimeSchema.nullable(),
  })
  .meta({ id: 'TriageView' });
export type TriageView = z.infer<typeof TriageViewSchema>;

export const CLAIM_KINDS = ['amount', 'date', 'number', 'percent', 'duration', 'isbn'] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

/**
 * Values a draft is allowed to state, with where each came from. Shipped with every draft so the
 * editor can re-run Leaf's fact check live, in the browser, while the admin edits.
 */
export const GroundingIndexSchema = z
  .object({
    facts: z.array(z.object({ id: z.string(), label: z.string(), text: z.string() })),
    allowed: z.array(z.object({ kind: z.enum(CLAIM_KINDS), value: z.string(), source: z.string() })),
  })
  .meta({ id: 'GroundingIndex' });
export type GroundingIndex = z.infer<typeof GroundingIndexSchema>;

export const DRAFT_CHECK_KINDS = [
  'fact',
  'fluff',
  'policy',
  'link',
  'placeholder',
  'tone',
  'leak',
  'length',
] as const;
export const DRAFT_CHECK_SEVERITIES = ['ok', 'info', 'warning', 'error'] as const;

export const DraftCheckSchema = z
  .object({
    kind: z.enum(DRAFT_CHECK_KINDS),
    severity: z.enum(DRAFT_CHECK_SEVERITIES),
    message: z.string(),
    text: z.string().optional(),
    start: z.number().int().optional(),
    end: z.number().int().optional(),
    source: z.string().optional(),
  })
  .meta({ id: 'DraftCheck' });
export type DraftCheck = z.infer<typeof DraftCheckSchema>;

export const ToneChecklistSchema = z.object({
  acknowledges: z.boolean(),
  specific: z.boolean(),
  timeline: z.boolean(),
  nextStep: z.boolean(),
  noFluff: z.boolean(),
});
export type ToneChecklist = z.infer<typeof ToneChecklistSchema>;

export const DraftVersionRefSchema = z.object({
  id: IdSchema,
  version: z.number().int(),
  status: z.enum(DRAFT_STATUSES),
  origin: z.enum(DRAFT_ORIGINS),
  preset: z.enum(REFINE_PRESETS).nullable(),
  createdAt: IsoDateTimeSchema,
});

export const AiDraftSchema = z
  .object({
    id: IdSchema,
    ticketId: IdSchema,
    version: z.number().int(),
    status: z.enum(DRAFT_STATUSES),
    origin: z.enum(DRAFT_ORIGINS),
    body: z.string().nullable(),
    preset: z.enum(REFINE_PRESETS).nullable(),
    instruction: z.string().nullable(),
    /** True when the conversation changed after this draft was written. */
    isStale: z.boolean(),
    factsUsed: z.array(z.string()),
    policiesUsed: z.array(z.object({ slug: z.string(), title: z.string() })),
    needsEscalation: z.boolean(),
    escalationTeam: z.enum(ESCALATION_TEAMS).nullable(),
    internalNextSteps: z.array(z.string()),
    checks: z.array(DraftCheckSchema),
    checklist: ToneChecklistSchema.nullable(),
    grounding: GroundingIndexSchema.nullable(),
    provider: z.string().nullable(),
    model: z.string().nullable(),
    latencyMs: z.number().int().nullable(),
    tokens: z.object({ input: z.number().int(), output: z.number().int() }).nullable(),
    error: z.string().nullable(),
    createdBy: PersonRefSchema.nullable(),
    createdAt: IsoDateTimeSchema,
    versions: z.array(DraftVersionRefSchema),
  })
  .meta({ id: 'AiDraft' });
export type AiDraft = z.infer<typeof AiDraftSchema>;

export const RegenerateDraftRequestSchema = z
  .object({
    preset: z.enum(REFINE_PRESETS).optional(),
    instruction: z.string().trim().max(LIMITS.refineInstruction.max).optional(),
    /** Version to refine; defaults to the latest ready draft. */
    baseDraftId: IdSchema.optional(),
  })
  .meta({ id: 'RegenerateDraftRequest' });
export type RegenerateDraftRequest = z.infer<typeof RegenerateDraftRequestSchema>;

/** Events streamed by POST /admin/tickets/{ref}/draft when the client accepts text/event-stream. */
export const DRAFT_STREAM_EVENTS = ['start', 'delta', 'done', 'error'] as const;
export type DraftStreamEvent =
  | { event: 'start'; data: { draftId: string; version: number } }
  | { event: 'delta'; data: { text: string } }
  | { event: 'done'; data: { draft: AiDraft } }
  | { event: 'error'; data: { code: string; message: string; draft: AiDraft | null } };

export const CIRCUIT_STATES = ['closed', 'open', 'half_open'] as const;

export const AiHealthSchema = z
  .object({
    status: z.enum(['operational', 'degraded', 'offline']),
    message: z.string(),
    providers: z.array(
      z.object({
        id: z.enum(AI_PROVIDER_IDS),
        configured: z.boolean(),
        circuit: z.enum(CIRCUIT_STATES),
        lastError: z.string().nullable(),
        lastSuccessAt: IsoDateTimeSchema.nullable(),
        lastFailureAt: IsoDateTimeSchema.nullable(),
      }),
    ),
    routes: z.record(z.enum(AI_TASKS), z.array(z.string())),
    guard: z.object({ configured: z.boolean(), model: z.string().nullable() }),
    embeddings: z.object({ configured: z.boolean(), model: z.string().nullable() }),
  })
  .meta({ id: 'AiHealth' });
export type AiHealth = z.infer<typeof AiHealthSchema>;
