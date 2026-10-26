/**
 * Domain vocabularies shared by the database, the API and the web app.
 * Values are stable identifiers (persisted + sent over the wire); labels are display copy.
 */

export const USER_ROLES = ['author', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
};
export const UNRESOLVED_STATUSES: readonly TicketStatus[] = ['open', 'in_progress'];

export const TICKET_CATEGORIES = [
  'royalty_payments',
  'isbn_metadata',
  'printing_quality',
  'distribution_availability',
  'book_status_production',
  'general_inquiry',
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
  royalty_payments: 'Royalty & Payments',
  isbn_metadata: 'ISBN & Metadata Issues',
  printing_quality: 'Printing & Quality',
  distribution_availability: 'Distribution & Availability',
  book_status_production: 'Book Status & Production Updates',
  general_inquiry: 'General Inquiry',
};

export const TICKET_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};
/** Lower rank = more urgent. */
export const PRIORITY_RANK: Record<TicketPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export const PRODUCTION_STAGES = [
  'manuscript_received',
  'editing',
  'cover_design',
  'typesetting',
  'proofreading',
  'isbn_assignment',
  'printing',
  'distribution_setup',
  'published_live',
] as const;
export type ProductionStage = (typeof PRODUCTION_STAGES)[number];
export const PRODUCTION_STAGE_LABELS: Record<ProductionStage, string> = {
  manuscript_received: 'Manuscript Received',
  editing: 'Editing',
  cover_design: 'Cover Design',
  typesetting: 'Typesetting',
  proofreading: 'Proofreading',
  isbn_assignment: 'ISBN Assignment',
  printing: 'Printing',
  distribution_setup: 'Distribution Setup',
  published_live: 'Published & Live',
};

export const SALES_PLATFORMS = ['amazon_in', 'flipkart', 'amazon_us', 'amazon_uk', 'bookleaf_store'] as const;
export type SalesPlatform = (typeof SALES_PLATFORMS)[number];
export const SALES_PLATFORM_LABELS: Record<SalesPlatform, string> = {
  amazon_in: 'Amazon India',
  flipkart: 'Flipkart',
  amazon_us: 'Amazon US',
  amazon_uk: 'Amazon UK',
  bookleaf_store: 'BookLeaf Store',
};

export const PRINT_PARTNERS = ['in_house', 'repro_india', 'epitome_books'] as const;
export type PrintPartner = (typeof PRINT_PARTNERS)[number];
export const PRINT_PARTNER_LABELS: Record<PrintPartner, string> = {
  in_house: 'BookLeaf In-House (Delhi)',
  repro_india: 'Repro India',
  epitome_books: 'Epitome Books',
};

/** Who decided a ticket's category/priority. Admin overrides always win over AI or rules. */
export const CLASSIFICATION_SOURCES = ['ai', 'rules', 'admin'] as const;
export type ClassificationSource = (typeof CLASSIFICATION_SOURCES)[number];

export const AI_JOB_STATUSES = ['pending', 'processing', 'completed', 'failed', 'skipped'] as const;
export type AiJobStatus = (typeof AI_JOB_STATUSES)[number];

export const SENTIMENTS = ['calm', 'concerned', 'frustrated', 'angry'] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const MESSAGE_SENDERS = ['author', 'admin', 'system'] as const;
export type MessageSender = (typeof MESSAGE_SENDERS)[number];

export const DRAFT_STATUSES = ['generating', 'ready', 'failed', 'superseded', 'sent', 'discarded'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export const DRAFT_ORIGINS = ['ai', 'scaffold'] as const;
export type DraftOrigin = (typeof DRAFT_ORIGINS)[number];

export const AI_FLAGS = [
  'possible_injection',
  'needs_review',
  'low_confidence',
  'rule_based',
  'policy_adjusted',
  'pii_redacted',
] as const;
export type AiFlag = (typeof AI_FLAGS)[number];
export const AI_FLAG_LABELS: Record<AiFlag, string> = {
  possible_injection: 'Possible manipulation attempt',
  needs_review: 'Needs review',
  low_confidence: 'Low AI confidence',
  rule_based: 'Classified by rules (AI unavailable)',
  policy_adjusted: 'Adjusted by BookLeaf policy',
  pii_redacted: 'Sensitive data masked for AI',
};

export const ESCALATION_TEAMS = [
  'finance',
  'production',
  'distribution',
  'printing',
  'author_success',
] as const;
export type EscalationTeam = (typeof ESCALATION_TEAMS)[number];
export const ESCALATION_TEAM_LABELS: Record<EscalationTeam, string> = {
  finance: 'Finance (royalties)',
  production: 'Production',
  distribution: 'Distribution',
  printing: 'Printing & Quality',
  author_success: 'Author Success',
};

export const REFINE_PRESETS = [
  'shorter',
  'warmer',
  'more_detail',
  'add_timeline',
  'more_formal',
  'simplify',
] as const;
export type RefinePreset = (typeof REFINE_PRESETS)[number];
export const REFINE_PRESET_LABELS: Record<RefinePreset, string> = {
  shorter: 'Shorter',
  warmer: 'Warmer',
  more_detail: 'More detail',
  add_timeline: 'Add timeline',
  more_formal: 'More formal',
  simplify: 'Simpler words',
};

export const SLA_STATES = ['met', 'on_track', 'at_risk', 'breached', 'paused', 'pending_triage'] as const;
export type SlaState = (typeof SLA_STATES)[number];

export const PAYOUT_STATUSES = [
  'not_applicable',
  'no_sales',
  'settled',
  'below_threshold',
  'scheduled',
  'attention',
] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const ALERT_KINDS = ['similar_cluster', 'category_spike'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export const ALERT_STATUSES = ['open', 'acknowledged', 'resolved'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  'ticket_reply',
  'ticket_status',
  'ticket_assigned',
  'ticket_created',
  'alert',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const ACTOR_TYPES = ['author', 'admin', 'system', 'ai'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const EVENT_VISIBILITIES = ['public', 'internal'] as const;
export type EventVisibility = (typeof EVENT_VISIBILITIES)[number];

export const TICKET_EVENT_TYPES = [
  'ticket.created',
  'ticket.triaged',
  'ticket.triage_failed',
  'ticket.status_changed',
  'ticket.reopened',
  'ticket.category_changed',
  'ticket.priority_changed',
  'ticket.assigned',
  'ticket.unassigned',
  'ticket.message_created',
  'ticket.note_added',
  'ticket.draft_ready',
  'ticket.draft_failed',
  'ticket.feedback',
] as const;
export type TicketEventType = (typeof TICKET_EVENT_TYPES)[number];

export const AI_PROVIDER_IDS = ['gemini', 'groq', 'openrouter'] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export const AI_TASKS = ['triage', 'draft', 'assist', 'summarize', 'embed', 'guard', 'judge'] as const;
export type AiTask = (typeof AI_TASKS)[number];
