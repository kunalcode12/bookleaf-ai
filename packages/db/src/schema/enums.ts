import {
  ACTOR_TYPES,
  AI_FLAGS,
  AI_JOB_STATUSES,
  AI_TASKS,
  ALERT_KINDS,
  ALERT_STATUSES,
  CLASSIFICATION_SOURCES,
  DRAFT_ORIGINS,
  DRAFT_STATUSES,
  ESCALATION_TEAMS,
  EVENT_VISIBILITIES,
  MESSAGE_SENDERS,
  NOTIFICATION_TYPES,
  PRINT_PARTNERS,
  PRODUCTION_STAGES,
  REFINE_PRESETS,
  SALES_PLATFORMS,
  SENTIMENTS,
  TICKET_CATEGORIES,
  TICKET_EVENT_TYPES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  USER_ROLES,
} from '@bookleaf/contracts';
import { pgSchema } from 'drizzle-orm/pg-core';

/**
 * All application tables live in the private `app` schema. Supabase's auto-generated Data API
 * only exposes `public`, so nothing here is reachable except through the BookLeaf API.
 */
export const app = pgSchema('app');

export const userRole = app.enum('user_role', USER_ROLES);
export const productionStage = app.enum('production_stage', PRODUCTION_STAGES);
export const salesPlatform = app.enum('sales_platform', SALES_PLATFORMS);
export const printPartner = app.enum('print_partner', PRINT_PARTNERS);
export const ticketStatus = app.enum('ticket_status', TICKET_STATUSES);
export const ticketCategory = app.enum('ticket_category', TICKET_CATEGORIES);
export const ticketPriority = app.enum('ticket_priority', TICKET_PRIORITIES);
export const classificationSource = app.enum('classification_source', CLASSIFICATION_SOURCES);
export const aiJobStatus = app.enum('ai_job_status', AI_JOB_STATUSES);
export const sentiment = app.enum('sentiment', SENTIMENTS);
export const aiFlag = app.enum('ai_flag', AI_FLAGS);
export const messageSender = app.enum('message_sender', MESSAGE_SENDERS);
export const actorType = app.enum('actor_type', ACTOR_TYPES);
export const eventVisibility = app.enum('event_visibility', EVENT_VISIBILITIES);
export const ticketEventType = app.enum('ticket_event_type', TICKET_EVENT_TYPES);
export const draftStatus = app.enum('draft_status', DRAFT_STATUSES);
export const draftOrigin = app.enum('draft_origin', DRAFT_ORIGINS);
export const refinePreset = app.enum('refine_preset', REFINE_PRESETS);
export const escalationTeam = app.enum('escalation_team', ESCALATION_TEAMS);
export const aiTask = app.enum('ai_task', AI_TASKS);
export const aiRunOutcome = app.enum('ai_run_outcome', ['success', 'error', 'fallback', 'skipped']);
export const attachmentStatus = app.enum('attachment_status', ['pending', 'uploaded', 'attached']);
export const kbExampleSource = app.enum('kb_example_source', ['policy_doc', 'promoted']);
export const notificationType = app.enum('notification_type', NOTIFICATION_TYPES);
export const alertKind = app.enum('alert_kind', ALERT_KINDS);
export const alertStatus = app.enum('alert_status', ALERT_STATUSES);
export const assistRole = app.enum('assist_role', ['author', 'leaf']);
