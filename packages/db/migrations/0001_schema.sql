CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TYPE "app"."actor_type" AS ENUM('author', 'admin', 'system', 'ai');--> statement-breakpoint
CREATE TYPE "app"."ai_flag" AS ENUM('possible_injection', 'needs_review', 'low_confidence', 'rule_based', 'policy_adjusted', 'pii_redacted');--> statement-breakpoint
CREATE TYPE "app"."ai_job_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "app"."ai_run_outcome" AS ENUM('success', 'error', 'fallback', 'skipped');--> statement-breakpoint
CREATE TYPE "app"."ai_task" AS ENUM('triage', 'draft', 'assist', 'summarize', 'embed', 'guard', 'judge');--> statement-breakpoint
CREATE TYPE "app"."alert_kind" AS ENUM('similar_cluster', 'category_spike');--> statement-breakpoint
CREATE TYPE "app"."alert_status" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "app"."assist_role" AS ENUM('author', 'leaf');--> statement-breakpoint
CREATE TYPE "app"."attachment_status" AS ENUM('pending', 'uploaded', 'attached');--> statement-breakpoint
CREATE TYPE "app"."classification_source" AS ENUM('ai', 'rules', 'admin');--> statement-breakpoint
CREATE TYPE "app"."draft_origin" AS ENUM('ai', 'scaffold');--> statement-breakpoint
CREATE TYPE "app"."draft_status" AS ENUM('generating', 'ready', 'failed', 'superseded', 'sent', 'discarded');--> statement-breakpoint
CREATE TYPE "app"."escalation_team" AS ENUM('finance', 'production', 'distribution', 'printing', 'author_success');--> statement-breakpoint
CREATE TYPE "app"."event_visibility" AS ENUM('public', 'internal');--> statement-breakpoint
CREATE TYPE "app"."kb_example_source" AS ENUM('policy_doc', 'promoted');--> statement-breakpoint
CREATE TYPE "app"."message_sender" AS ENUM('author', 'admin', 'system');--> statement-breakpoint
CREATE TYPE "app"."notification_type" AS ENUM('ticket_reply', 'ticket_status', 'ticket_assigned', 'ticket_created', 'alert');--> statement-breakpoint
CREATE TYPE "app"."print_partner" AS ENUM('in_house', 'repro_india', 'epitome_books');--> statement-breakpoint
CREATE TYPE "app"."production_stage" AS ENUM('manuscript_received', 'editing', 'cover_design', 'typesetting', 'proofreading', 'isbn_assignment', 'printing', 'distribution_setup', 'published_live');--> statement-breakpoint
CREATE TYPE "app"."refine_preset" AS ENUM('shorter', 'warmer', 'more_detail', 'add_timeline', 'more_formal', 'simplify');--> statement-breakpoint
CREATE TYPE "app"."sales_platform" AS ENUM('amazon_in', 'flipkart', 'amazon_us', 'amazon_uk', 'bookleaf_store');--> statement-breakpoint
CREATE TYPE "app"."sentiment" AS ENUM('calm', 'concerned', 'frustrated', 'angry');--> statement-breakpoint
CREATE TYPE "app"."ticket_category" AS ENUM('royalty_payments', 'isbn_metadata', 'printing_quality', 'distribution_availability', 'book_status_production', 'general_inquiry');--> statement-breakpoint
CREATE TYPE "app"."ticket_event_type" AS ENUM('ticket.created', 'ticket.triaged', 'ticket.triage_failed', 'ticket.status_changed', 'ticket.reopened', 'ticket.category_changed', 'ticket.priority_changed', 'ticket.assigned', 'ticket.unassigned', 'ticket.message_created', 'ticket.note_added', 'ticket.draft_ready', 'ticket.draft_failed', 'ticket.feedback');--> statement-breakpoint
CREATE TYPE "app"."ticket_priority" AS ENUM('critical', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "app"."ticket_status" AS ENUM('open', 'in_progress', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "app"."user_role" AS ENUM('author', 'admin');--> statement-breakpoint
CREATE TABLE "app"."ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid,
	"draft_id" uuid,
	"task" "app"."ai_task" NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text,
	"outcome" "app"."ai_run_outcome" NOT NULL,
	"error_code" text,
	"error_message" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"estimated_cost_usd" numeric(14, 8) DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."authors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"city" text,
	"joined_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authors_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "app"."book_listings" (
	"book_id" uuid NOT NULL,
	"platform" "app"."sales_platform" NOT NULL,
	"listed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_listings_book_id_platform_pk" PRIMARY KEY("book_id","platform")
);
--> statement-breakpoint
CREATE TABLE "app"."books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"author_id" uuid NOT NULL,
	"title" text NOT NULL,
	"isbn" text NOT NULL,
	"genre" text NOT NULL,
	"publication_date" date,
	"stage" "app"."production_stage" NOT NULL,
	"mrp_minor" bigint,
	"royalty_per_copy_minor" bigint,
	"copies_sold" integer DEFAULT 0 NOT NULL,
	"royalty_earned_minor" bigint DEFAULT 0 NOT NULL,
	"royalty_paid_minor" bigint DEFAULT 0 NOT NULL,
	"royalty_pending_minor" bigint GENERATED ALWAYS AS ("royalty_earned_minor" - "royalty_paid_minor") STORED NOT NULL,
	"last_payout_date" date,
	"print_partner" "app"."print_partner",
	"stage_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "books_external_id_unique" UNIQUE("external_id"),
	CONSTRAINT "books_isbn_unique" UNIQUE("isbn"),
	CONSTRAINT "books_copies_nonneg_check" CHECK ("app"."books"."copies_sold" >= 0),
	CONSTRAINT "books_money_nonneg_check" CHECK ("app"."books"."royalty_earned_minor" >= 0 and "app"."books"."royalty_paid_minor" >= 0 and coalesce("app"."books"."mrp_minor", 0) >= 0 and coalesce("app"."books"."royalty_per_copy_minor", 0) >= 0),
	CONSTRAINT "books_paid_within_earned_check" CHECK ("app"."books"."royalty_paid_minor" <= "app"."books"."royalty_earned_minor"),
	CONSTRAINT "books_published_fields_check" CHECK ("app"."books"."stage" <> 'published_live' or ("app"."books"."publication_date" is not null and "app"."books"."mrp_minor" is not null and "app"."books"."royalty_per_copy_minor" is not null)),
	CONSTRAINT "books_unpublished_no_sales_check" CHECK ("app"."books"."stage" = 'published_live' or ("app"."books"."copies_sold" = 0 and "app"."books"."royalty_earned_minor" = 0)),
	CONSTRAINT "books_royalty_ledger_check" CHECK ("app"."books"."royalty_per_copy_minor" is null or "app"."books"."royalty_earned_minor" = "app"."books"."copies_sold"::bigint * "app"."books"."royalty_per_copy_minor")
);
--> statement-breakpoint
CREATE TABLE "app"."profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" "app"."user_role" NOT NULL,
	"display_name" text NOT NULL,
	"title" text,
	"author_id" uuid,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_author_id_unique" UNIQUE("author_id"),
	CONSTRAINT "profiles_author_link_check" CHECK (("app"."profiles"."role" = 'author') = ("app"."profiles"."author_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "app"."kb_examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" "app"."ticket_category" NOT NULL,
	"query" text NOT NULL,
	"guidance" text NOT NULL,
	"sample_reply" text,
	"source" "app"."kb_example_source" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"source_message_id" uuid,
	"embedding" vector(768),
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."kb_section_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"categories" "app"."ticket_category"[] NOT NULL,
	"edited_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."kb_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"categories" "app"."ticket_category"[] DEFAULT '{}'::app.ticket_category[] NOT NULL,
	"always_include" boolean DEFAULT false NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"token_estimate" integer DEFAULT 0 NOT NULL,
	"embedding" vector(768),
	"embedding_model" text,
	"embedded_version" integer,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("body", '')), 'B')) STORED,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_sections_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "app"."assist_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"book_id" uuid,
	"resolved" boolean,
	"converted_ticket_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."assist_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "app"."assist_role" NOT NULL,
	"body" text NOT NULL,
	"needs_human" boolean,
	"suggested_category" "app"."ticket_category",
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"origin" text,
	"helpful" boolean,
	"provider" text,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."incident_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "app"."alert_kind" NOT NULL,
	"status" "app"."alert_status" DEFAULT 'open' NOT NULL,
	"fingerprint" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"category" "app"."ticket_category",
	"ticket_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"acknowledged_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"type" "app"."notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"ticket_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ai_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "app"."draft_status" NOT NULL,
	"origin" "app"."draft_origin" DEFAULT 'ai' NOT NULL,
	"body" text,
	"preset" "app"."refine_preset",
	"instruction" text,
	"base_draft_id" uuid,
	"thread_version" integer NOT NULL,
	"facts_used" text[] DEFAULT '{}'::text[] NOT NULL,
	"policies_used" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"needs_escalation" boolean DEFAULT false NOT NULL,
	"escalation_team" "app"."escalation_team",
	"internal_next_steps" text[] DEFAULT '{}'::text[] NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checklist" jsonb,
	"grounding" jsonb,
	"provider" text,
	"model" text,
	"prompt_version" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"baseline_input_tokens" integer,
	"latency_ms" integer,
	"error" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ticket_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid,
	"message_id" uuid,
	"uploader_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"status" "app"."attachment_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_attachments_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "ticket_attachments_size_check" CHECK ("app"."ticket_attachments"."size_bytes" > 0 and "app"."ticket_attachments"."size_bytes" <= 10485760)
);
--> statement-breakpoint
CREATE TABLE "app"."ticket_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "app"."ticket_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ticket_id" uuid NOT NULL,
	"actor_type" "app"."actor_type" NOT NULL,
	"actor_id" uuid,
	"type" "app"."ticket_event_type" NOT NULL,
	"visibility" "app"."event_visibility" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_events_seq_unique" UNIQUE("seq")
);
--> statement-breakpoint
CREATE TABLE "app"."ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"sender_type" "app"."message_sender" NOT NULL,
	"sender_id" uuid,
	"sender_name" text NOT NULL,
	"sender_title" text,
	"body" text NOT NULL,
	"draft_id" uuid,
	"draft_edit_ratio" real,
	"client_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_messages_body_length_check" CHECK (char_length("app"."ticket_messages"."body") between 1 and 5000)
);
--> statement-breakpoint
CREATE TABLE "app"."ticket_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_notes_body_length_check" CHECK (char_length("app"."ticket_notes"."body") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "app"."tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "app"."tickets_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1001 CACHE 1),
	"author_id" uuid NOT NULL,
	"book_id" uuid,
	"created_by_id" uuid NOT NULL,
	"subject" varchar(150) NOT NULL,
	"description" text NOT NULL,
	"status" "app"."ticket_status" DEFAULT 'open' NOT NULL,
	"category" "app"."ticket_category",
	"category_source" "app"."classification_source",
	"priority" "app"."ticket_priority",
	"priority_source" "app"."classification_source",
	"secondary_category" "app"."ticket_category",
	"ai_category" "app"."ticket_category",
	"ai_priority" "app"."ticket_priority",
	"ai_confidence" real,
	"ai_summary" text,
	"ai_rationale" text,
	"ai_sentiment" "app"."sentiment",
	"ai_language" text,
	"ai_signals" jsonb,
	"ai_flags" "app"."ai_flag"[] DEFAULT '{}'::app.ai_flag[] NOT NULL,
	"policy_adjustments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"injection" jsonb,
	"triage_status" "app"."ai_job_status" DEFAULT 'pending' NOT NULL,
	"triage_attempts" integer DEFAULT 0 NOT NULL,
	"triage_error" text,
	"triage_provider" text,
	"triage_model" text,
	"triaged_at" timestamp with time zone,
	"draft_status" "app"."ai_job_status" DEFAULT 'pending' NOT NULL,
	"assignee_id" uuid,
	"sla_due_at" timestamp with time zone,
	"first_response_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"last_author_message_at" timestamp with time zone,
	"last_admin_message_at" timestamp with time zone,
	"author_last_read_at" timestamp with time zone,
	"message_count" integer DEFAULT 0 NOT NULL,
	"thread_version" integer DEFAULT 1 NOT NULL,
	"context_summary" text,
	"context_summary_up_to" integer,
	"feedback_rating" smallint,
	"feedback_comment" text,
	"feedback_at" timestamp with time zone,
	"client_request_id" uuid,
	"embedding" vector(768),
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("subject", '')), 'A') || setweight(to_tsvector('english', coalesce("description", '')), 'B')) STORED,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_number_unique" UNIQUE("number"),
	CONSTRAINT "tickets_subject_length_check" CHECK (char_length("app"."tickets"."subject") between 1 and 150),
	CONSTRAINT "tickets_description_length_check" CHECK (char_length("app"."tickets"."description") between 1 and 5000),
	CONSTRAINT "tickets_feedback_rating_check" CHECK ("app"."tickets"."feedback_rating" is null or "app"."tickets"."feedback_rating" in (-1, 1)),
	CONSTRAINT "tickets_confidence_range_check" CHECK ("app"."tickets"."ai_confidence" is null or ("app"."tickets"."ai_confidence" >= 0 and "app"."tickets"."ai_confidence" <= 1))
);
--> statement-breakpoint
ALTER TABLE "app"."ai_runs" ADD CONSTRAINT "ai_runs_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "app"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_runs" ADD CONSTRAINT "ai_runs_draft_id_ai_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "app"."ai_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."book_listings" ADD CONSTRAINT "book_listings_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "app"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."books" ADD CONSTRAINT "books_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "app"."authors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."profiles" ADD CONSTRAINT "profiles_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "app"."authors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."kb_examples" ADD CONSTRAINT "kb_examples_source_message_id_ticket_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "app"."ticket_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."kb_examples" ADD CONSTRAINT "kb_examples_created_by_id_profiles_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "app"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."kb_section_versions" ADD CONSTRAINT "kb_section_versions_section_id_kb_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "app"."kb_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."kb_section_versions" ADD CONSTRAINT "kb_section_versions_edited_by_id_profiles_id_fk" FOREIGN KEY ("edited_by_id") REFERENCES "app"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."kb_sections" ADD CONSTRAINT "kb_sections_updated_by_id_profiles_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "app"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."assist_conversations" ADD CONSTRAINT "assist_conversations_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "app"."authors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."assist_conversations" ADD CONSTRAINT "assist_conversations_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "app"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."assist_conversations" ADD CONSTRAINT "assist_conversations_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "app"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."assist_conversations" ADD CONSTRAINT "assist_conversations_converted_ticket_id_tickets_id_fk" FOREIGN KEY ("converted_ticket_id") REFERENCES "app"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."assist_messages" ADD CONSTRAINT "assist_messages_conversation_id_assist_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "app"."assist_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."incident_alerts" ADD CONSTRAINT "incident_alerts_acknowledged_by_id_profiles_id_fk" FOREIGN KEY ("acknowledged_by_id") REFERENCES "app"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD CONSTRAINT "notifications_recipient_id_profiles_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "app"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD CONSTRAINT "notifications_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "app"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_drafts" ADD CONSTRAINT "ai_drafts_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "app"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_drafts" ADD CONSTRAINT "ai_drafts_created_by_id_profiles_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "app"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ticket_attachments" ADD CONSTRAINT "ticket_attachments_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "app"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ticket_attachments" ADD CONSTRAINT "ticket_attachments_message_id_ticket_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "app"."ticket_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ticket_attachments" ADD CONSTRAINT "ticket_attachments_uploader_id_profiles_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "app"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "app"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ticket_events" ADD CONSTRAINT "ticket_events_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "app"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "app"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ticket_messages" ADD CONSTRAINT "ticket_messages_sender_id_profiles_id_fk" FOREIGN KEY ("sender_id") REFERENCES "app"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ticket_messages" ADD CONSTRAINT "ticket_messages_draft_id_ai_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "app"."ai_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ticket_notes" ADD CONSTRAINT "ticket_notes_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "app"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ticket_notes" ADD CONSTRAINT "ticket_notes_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "app"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tickets" ADD CONSTRAINT "tickets_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "app"."authors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tickets" ADD CONSTRAINT "tickets_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "app"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tickets" ADD CONSTRAINT "tickets_created_by_id_profiles_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "app"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tickets" ADD CONSTRAINT "tickets_assignee_id_profiles_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "app"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_runs_created_idx" ON "app"."ai_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_runs_task_created_idx" ON "app"."ai_runs" USING btree ("task","created_at");--> statement-breakpoint
CREATE INDEX "ai_runs_ticket_idx" ON "app"."ai_runs" USING btree ("ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "authors_email_lower_key" ON "app"."authors" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "books_author_idx" ON "app"."books" USING btree ("author_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_email_lower_key" ON "app"."profiles" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "kb_examples_category_idx" ON "app"."kb_examples" USING btree ("category","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_section_versions_key" ON "app"."kb_section_versions" USING btree ("section_id","version");--> statement-breakpoint
CREATE INDEX "kb_sections_search_idx" ON "app"."kb_sections" USING gin ("search");--> statement-breakpoint
CREATE INDEX "assist_conversations_author_idx" ON "app"."assist_conversations" USING btree ("author_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "assist_messages_conversation_idx" ON "app"."assist_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_alerts_fingerprint_key" ON "app"."incident_alerts" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "app"."notifications" USING btree ("recipient_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "app"."notifications" USING btree ("recipient_id") WHERE "app"."notifications"."read_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_drafts_ticket_version_key" ON "app"."ai_drafts" USING btree ("ticket_id","version");--> statement-breakpoint
CREATE INDEX "ai_drafts_ticket_created_idx" ON "app"."ai_drafts" USING btree ("ticket_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ticket_attachments_ticket_idx" ON "app"."ticket_attachments" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "ticket_attachments_uploader_idx" ON "app"."ticket_attachments" USING btree ("uploader_id","status");--> statement-breakpoint
CREATE INDEX "ticket_events_ticket_idx" ON "app"."ticket_events" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "ticket_messages_ticket_idx" ON "app"."ticket_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_messages_client_request_key" ON "app"."ticket_messages" USING btree ("ticket_id","client_request_id");--> statement-breakpoint
CREATE INDEX "ticket_notes_ticket_idx" ON "app"."ticket_notes" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "tickets_queue_idx" ON "app"."tickets" USING btree ("status","priority","created_at");--> statement-breakpoint
CREATE INDEX "tickets_author_created_idx" ON "app"."tickets" USING btree ("author_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tickets_book_idx" ON "app"."tickets" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "tickets_assignee_open_idx" ON "app"."tickets" USING btree ("assignee_id") WHERE "app"."tickets"."status" in ('open', 'in_progress');--> statement-breakpoint
CREATE INDEX "tickets_sla_open_idx" ON "app"."tickets" USING btree ("sla_due_at") WHERE "app"."tickets"."first_response_at" is null and "app"."tickets"."status" in ('open', 'in_progress');--> statement-breakpoint
CREATE INDEX "tickets_triage_pending_idx" ON "app"."tickets" USING btree ("created_at") WHERE "app"."tickets"."triage_status" in ('pending', 'processing');--> statement-breakpoint
CREATE INDEX "tickets_search_idx" ON "app"."tickets" USING gin ("search");--> statement-breakpoint
CREATE INDEX "tickets_embedding_idx" ON "app"."tickets" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_client_request_key" ON "app"."tickets" USING btree ("author_id","client_request_id");