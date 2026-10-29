import { z } from 'zod';
import { AiDraftSchema, TriageViewSchema } from './ai';
import { BookSchema } from './books';
import {
  CursorQuerySchema,
  csvEnum,
  IdSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  MoneySchema,
  PersonRefSchema,
  paginated,
  TicketRefSchema,
} from './common';
import {
  ACTOR_TYPES,
  AI_FLAGS,
  AI_JOB_STATUSES,
  CLASSIFICATION_SOURCES,
  EVENT_VISIBILITIES,
  MESSAGE_SENDERS,
  PRODUCTION_STAGES,
  SLA_STATES,
  TICKET_CATEGORIES,
  TICKET_EVENT_TYPES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
} from './enums';
import { LIMITS } from './limits';

// ─── Shared pieces ──────────────────────────────────────────────────────────

export const TicketParamsSchema = z.object({ ticketRef: TicketRefSchema });

export const AttachmentSchema = z
  .object({
    id: IdSchema,
    fileName: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int(),
    /** Short-lived signed download link. */
    url: z.string().nullable(),
    createdAt: IsoDateTimeSchema,
  })
  .meta({ id: 'Attachment' });
export type Attachment = z.infer<typeof AttachmentSchema>;

export const TicketBookRefSchema = z
  .object({
    id: IdSchema,
    externalId: z.string(),
    title: z.string(),
    status: z.enum(PRODUCTION_STAGES),
  })
  .meta({ id: 'TicketBookRef' });

export const TicketMessageSchema = z
  .object({
    id: IdSchema,
    sender: z.enum(MESSAGE_SENDERS),
    senderName: z.string(),
    senderTitle: z.string().nullable(),
    body: z.string(),
    attachments: z.array(AttachmentSchema),
    createdAt: IsoDateTimeSchema,
  })
  .meta({ id: 'TicketMessage' });
export type TicketMessage = z.infer<typeof TicketMessageSchema>;

export const FeedbackSchema = z.object({
  rating: z.enum(['up', 'down']),
  comment: z.string().nullable(),
  at: IsoDateTimeSchema,
});

const subject = z
  .string()
  .trim()
  .min(LIMITS.subject.min, `Subject needs at least ${LIMITS.subject.min} characters`)
  .max(LIMITS.subject.max, `Subject can be at most ${LIMITS.subject.max} characters`);
const description = z
  .string()
  .trim()
  .min(LIMITS.description.min, `Please describe the issue in at least ${LIMITS.description.min} characters`)
  .max(LIMITS.description.max, `Description can be at most ${LIMITS.description.max} characters`);
const messageBody = z
  .string()
  .trim()
  .min(LIMITS.message.min, 'Message cannot be empty')
  .max(LIMITS.message.max, `Message can be at most ${LIMITS.message.max} characters`);
const attachmentIds = z.array(IdSchema).max(LIMITS.attachments.maxFiles).default([]);

// ─── Author-facing ──────────────────────────────────────────────────────────

export const AuthorTicketSummarySchema = z
  .object({
    id: IdSchema,
    number: z.string(),
    subject: z.string(),
    status: z.enum(TICKET_STATUSES),
    /** Shown to authors as the team their query was routed to. */
    category: z.enum(TICKET_CATEGORIES).nullable(),
    book: TicketBookRefSchema.nullable(),
    expectedResponse: z.string().nullable(),
    hasUnreadReply: z.boolean(),
    messageCount: z.number().int(),
    lastActivityAt: IsoDateTimeSchema,
    createdAt: IsoDateTimeSchema,
  })
  .meta({ id: 'AuthorTicketSummary' });
export type AuthorTicketSummary = z.infer<typeof AuthorTicketSummarySchema>;

export const AuthorTimelineEntrySchema = z.object({
  type: z.enum(['created', 'status_changed', 'reopened']),
  status: z.enum(TICKET_STATUSES).nullable(),
  at: IsoDateTimeSchema,
});

export const AuthorTicketDetailSchema = AuthorTicketSummarySchema.extend({
  description: z.string(),
  attachments: z.array(AttachmentSchema),
  messages: z.array(TicketMessageSchema),
  timeline: z.array(AuthorTimelineEntrySchema),
  canReply: z.boolean(),
  canGiveFeedback: z.boolean(),
  feedback: FeedbackSchema.nullable(),
}).meta({ id: 'AuthorTicketDetail' });
export type AuthorTicketDetail = z.infer<typeof AuthorTicketDetailSchema>;

export const AuthorTicketListQuerySchema = CursorQuerySchema.extend({
  status: z.enum([...TICKET_STATUSES, 'active']).optional(),
});
export type AuthorTicketListQuery = z.infer<typeof AuthorTicketListQuerySchema>;

export const AuthorTicketListResponseSchema = paginated(AuthorTicketSummarySchema).meta({
  id: 'AuthorTicketList',
});
export type AuthorTicketListResponse = z.infer<typeof AuthorTicketListResponseSchema>;

export const CreateTicketRequestSchema = z
  .object({
    /** null or omitted = "General / Account Level". */
    bookId: IdSchema.nullish().transform((v) => v ?? null),
    subject,
    description,
    attachmentIds,
  })
  .meta({ id: 'CreateTicketRequest' });
export type CreateTicketRequest = z.input<typeof CreateTicketRequestSchema>;

export const CreateAuthorMessageRequestSchema = z
  .object({ body: messageBody, attachmentIds })
  .meta({ id: 'CreateAuthorMessageRequest' });
export type CreateAuthorMessageRequest = z.input<typeof CreateAuthorMessageRequestSchema>;

export const TicketFeedbackRequestSchema = z
  .object({
    rating: z.enum(['up', 'down']),
    comment: z.string().trim().max(LIMITS.feedbackComment.max).optional(),
  })
  .meta({ id: 'TicketFeedbackRequest' });
export type TicketFeedbackRequest = z.infer<typeof TicketFeedbackRequestSchema>;

// ─── Admin-facing ───────────────────────────────────────────────────────────

export const SlaViewSchema = z.object({
  dueAt: IsoDateTimeSchema.nullable(),
  state: z.enum(SLA_STATES),
  minutesRemaining: z.number().int().nullable(),
  targetHours: z.number().int().nullable(),
});
export type SlaView = z.infer<typeof SlaViewSchema>;

export const AdminTicketListItemSchema = z
  .object({
    id: IdSchema,
    number: z.string(),
    subject: z.string(),
    status: z.enum(TICKET_STATUSES),
    category: z.enum(TICKET_CATEGORIES).nullable(),
    categorySource: z.enum(CLASSIFICATION_SOURCES).nullable(),
    priority: z.enum(TICKET_PRIORITIES).nullable(),
    prioritySource: z.enum(CLASSIFICATION_SOURCES).nullable(),
    aiSummary: z.string().nullable(),
    aiConfidence: z.number().nullable(),
    aiFlags: z.array(z.enum(AI_FLAGS)),
    triageStatus: z.enum(AI_JOB_STATUSES),
    draftStatus: z.enum(AI_JOB_STATUSES),
    author: z.object({ id: IdSchema, externalId: z.string(), name: z.string() }),
    book: TicketBookRefSchema.nullable(),
    assignee: PersonRefSchema.nullable(),
    sla: SlaViewSchema,
    urgency: z.number().int(),
    messageCount: z.number().int(),
    hasAttachments: z.boolean(),
    awaitingReply: z.boolean(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    firstResponseAt: IsoDateTimeSchema.nullable(),
    lastAuthorMessageAt: IsoDateTimeSchema.nullable(),
  })
  .meta({ id: 'AdminTicketListItem' });
export type AdminTicketListItem = z.infer<typeof AdminTicketListItemSchema>;

export const ADMIN_TICKET_SORTS = ['urgency', 'newest', 'oldest', 'updated', 'priority'] as const;
export type AdminTicketSort = (typeof ADMIN_TICKET_SORTS)[number];

export const AdminTicketListQuerySchema = CursorQuerySchema.extend({
  status: csvEnum(TICKET_STATUSES),
  category: csvEnum(TICKET_CATEGORIES),
  priority: csvEnum(TICKET_PRIORITIES),
  assignee: z.union([z.literal('me'), z.literal('unassigned'), IdSchema]).optional(),
  createdFrom: IsoDateSchema.optional(),
  createdTo: IsoDateSchema.optional(),
  q: z.string().trim().max(LIMITS.search.max).optional(),
  flag: z.enum(AI_FLAGS).optional(),
  sla: z.enum(['breached', 'at_risk']).optional(),
  authorId: IdSchema.optional(),
  sort: z.enum(ADMIN_TICKET_SORTS).default('urgency'),
});
export type AdminTicketListQuery = z.infer<typeof AdminTicketListQuerySchema>;

export const AdminTicketListResponseSchema = paginated(AdminTicketListItemSchema).meta({
  id: 'AdminTicketList',
});
export type AdminTicketListResponse = z.infer<typeof AdminTicketListResponseSchema>;

export const QueueStatsSchema = z
  .object({
    unresolved: z.number().int(),
    open: z.number().int(),
    inProgress: z.number().int(),
    critical: z.number().int(),
    high: z.number().int(),
    breaching: z.number().int(),
    atRisk: z.number().int(),
    unassigned: z.number().int(),
    mine: z.number().int(),
    needsReview: z.number().int(),
    awaitingTriage: z.number().int(),
    possibleInjection: z.number().int(),
    resolvedToday: z.number().int(),
  })
  .meta({ id: 'QueueStats' });
export type QueueStats = z.infer<typeof QueueStatsSchema>;

export const InternalNoteSchema = z
  .object({
    id: IdSchema,
    body: z.string(),
    author: PersonRefSchema,
    createdAt: IsoDateTimeSchema,
  })
  .meta({ id: 'InternalNote' });
export type InternalNote = z.infer<typeof InternalNoteSchema>;

export const TicketEventSchema = z
  .object({
    id: z.string(),
    type: z.enum(TICKET_EVENT_TYPES),
    actor: z.object({
      type: z.enum(ACTOR_TYPES),
      id: IdSchema.nullable(),
      name: z.string().nullable(),
    }),
    visibility: z.enum(EVENT_VISIBILITIES),
    payload: z.record(z.string(), z.unknown()),
    createdAt: IsoDateTimeSchema,
  })
  .meta({ id: 'TicketEvent' });
export type TicketEvent = z.infer<typeof TicketEventSchema>;

export const SimilarTicketSchema = z.object({
  id: IdSchema,
  number: z.string(),
  subject: z.string(),
  status: z.enum(TICKET_STATUSES),
  category: z.enum(TICKET_CATEGORIES).nullable(),
  authorName: z.string(),
  similarity: z.number(),
  createdAt: IsoDateTimeSchema,
});
export type SimilarTicket = z.infer<typeof SimilarTicketSchema>;

export const AuthorContextSchema = z
  .object({
    id: IdSchema,
    externalId: z.string(),
    name: z.string(),
    email: z.string(),
    phone: z.string().nullable(),
    city: z.string().nullable(),
    joinedDate: IsoDateSchema,
    totals: z.object({
      royaltyEarned: MoneySchema,
      royaltyPaid: MoneySchema,
      royaltyPending: MoneySchema,
      copiesSold: z.number().int(),
    }),
    books: z.array(BookSchema),
    recentTickets: z.array(
      z.object({
        id: IdSchema,
        number: z.string(),
        subject: z.string(),
        status: z.enum(TICKET_STATUSES),
        createdAt: IsoDateTimeSchema,
      }),
    ),
  })
  .meta({ id: 'AuthorContext' });
export type AuthorContext = z.infer<typeof AuthorContextSchema>;

export const AdminTicketDetailSchema = AdminTicketListItemSchema.extend({
  description: z.string(),
  attachments: z.array(AttachmentSchema),
  messages: z.array(TicketMessageSchema),
  notes: z.array(InternalNoteSchema),
  events: z.array(TicketEventSchema),
  triage: TriageViewSchema,
  draft: AiDraftSchema.nullable(),
  authorContext: AuthorContextSchema,
  similarTickets: z.array(SimilarTicketSchema),
  allowedTransitions: z.array(z.enum(TICKET_STATUSES)),
  feedback: FeedbackSchema.nullable(),
  resolvedAt: IsoDateTimeSchema.nullable(),
  closedAt: IsoDateTimeSchema.nullable(),
  version: z.number().int(),
}).meta({ id: 'AdminTicketDetail' });
export type AdminTicketDetail = z.infer<typeof AdminTicketDetailSchema>;

export const UpdateTicketRequestSchema = z
  .object({
    status: z.enum(TICKET_STATUSES).optional(),
    category: z.enum(TICKET_CATEGORIES).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
  })
  .refine((v) => v.status !== undefined || v.category !== undefined || v.priority !== undefined, {
    message: 'Provide at least one of status, category or priority',
  })
  .meta({ id: 'UpdateTicketRequest' });
export type UpdateTicketRequest = z.infer<typeof UpdateTicketRequestSchema>;

export const AssignTicketRequestSchema = z
  .object({
    /** "me" assigns the caller; null unassigns. */
    assigneeId: z.union([z.literal('me'), IdSchema]).nullable(),
    /** Take over a ticket another admin already owns. */
    force: z.boolean().default(false),
  })
  .meta({ id: 'AssignTicketRequest' });
export type AssignTicketRequest = z.input<typeof AssignTicketRequestSchema>;

export const AdminReplyRequestSchema = z
  .object({
    body: messageBody,
    /** The Leaf draft this reply started from, for quality metrics. */
    draftId: IdSchema.optional(),
    /** Send and mark the ticket Resolved in one step. */
    resolve: z.boolean().default(false),
    attachmentIds,
  })
  .meta({ id: 'AdminReplyRequest' });
export type AdminReplyRequest = z.input<typeof AdminReplyRequestSchema>;

export const CreateNoteRequestSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(LIMITS.note.min, 'Note cannot be empty')
      .max(LIMITS.note.max, `Note can be at most ${LIMITS.note.max} characters`),
  })
  .meta({ id: 'CreateNoteRequest' });
export type CreateNoteRequest = z.infer<typeof CreateNoteRequestSchema>;

export const AdminListOptionSchema = z.object({
  id: IdSchema,
  displayName: z.string(),
  title: z.string().nullable(),
});
export const AdminDirectoryResponseSchema = z
  .object({ data: z.array(AdminListOptionSchema) })
  .meta({ id: 'AdminDirectory' });
