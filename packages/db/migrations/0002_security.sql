-- ════════════════════════════════════════════════════════════════════════════
-- Security: restricted application role, actor context, row-level security,
-- housekeeping triggers and realtime change notifications.
--
-- Every API transaction runs `SET LOCAL ROLE bookleaf_app` and records the caller
-- (app.actor_role / app.actor_id / app.actor_author_id) — see packages/db/src/actor.ts.
-- The policies below read that context, so authorization is enforced by the database
-- as well as by the service layer. A code path that forgets to set the context sees
-- nothing: every policy fails closed.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bookleaf_app') THEN
    CREATE ROLE bookleaf_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE format('GRANT bookleaf_app TO %I', current_user);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not grant bookleaf_app to %: %', current_user, SQLERRM;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO bookleaf_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO bookleaf_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO bookleaf_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bookleaf_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO bookleaf_app;
--> statement-breakpoint
-- Supabase's public Data API roles must never reach the app schema.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA app FROM anon';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA app FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA app FROM authenticated';
  END IF;
END
$$;
--> statement-breakpoint

-- ─── Actor context ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.actor_role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.actor_role', true), '')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.actor_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.actor_id', true), '')::uuid
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.actor_author_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.actor_author_id', true), '')::uuid
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.is_staff() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(app.actor_role() IN ('admin', 'system'), false)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.owns_ticket(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.tickets t WHERE t.id = target AND t.author_id = app.actor_author_id()
  )
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.actor_role(), app.actor_id(), app.actor_author_id(), app.is_staff(), app.owns_ticket(uuid) TO bookleaf_app;
--> statement-breakpoint

-- ─── Row-level security ────────────────────────────────────────────────────
ALTER TABLE app.authors ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.books ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.book_listings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.tickets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.ticket_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.ticket_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.ticket_attachments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.ticket_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.ai_drafts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.ai_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.kb_sections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.kb_section_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.kb_examples ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.incident_alerts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.assist_conversations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.assist_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Staff (admins and the background worker) can work on everything.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'authors', 'profiles', 'books', 'book_listings', 'tickets', 'ticket_messages', 'ticket_notes',
    'ticket_attachments', 'ticket_events', 'ai_drafts', 'ai_runs', 'kb_sections', 'kb_section_versions',
    'kb_examples', 'notifications', 'incident_alerts', 'assist_conversations', 'assist_messages'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY staff_all ON app.%I FOR ALL TO bookleaf_app USING (app.is_staff()) WITH CHECK (app.is_staff())',
      tbl
    );
  END LOOP;
END
$$;
--> statement-breakpoint

-- Authors: only their own records. (No author policies exist for ticket_notes, ai_drafts,
-- ai_runs, kb_section_versions, kb_examples or incident_alerts — authors can never read them.)
CREATE POLICY author_self_read ON app.authors FOR SELECT TO bookleaf_app
  USING (id = app.actor_author_id());
--> statement-breakpoint
CREATE POLICY self_read ON app.profiles FOR SELECT TO bookleaf_app
  USING (id = app.actor_id());
--> statement-breakpoint
CREATE POLICY self_update ON app.profiles FOR UPDATE TO bookleaf_app
  USING (id = app.actor_id()) WITH CHECK (id = app.actor_id());
--> statement-breakpoint
CREATE POLICY author_read ON app.books FOR SELECT TO bookleaf_app
  USING (author_id = app.actor_author_id());
--> statement-breakpoint
CREATE POLICY author_read ON app.book_listings FOR SELECT TO bookleaf_app
  USING (EXISTS (SELECT 1 FROM app.books b WHERE b.id = book_id AND b.author_id = app.actor_author_id()));
--> statement-breakpoint
CREATE POLICY author_read ON app.tickets FOR SELECT TO bookleaf_app
  USING (author_id = app.actor_author_id());
--> statement-breakpoint
CREATE POLICY author_insert ON app.tickets FOR INSERT TO bookleaf_app
  WITH CHECK (author_id = app.actor_author_id() AND created_by_id = app.actor_id());
--> statement-breakpoint
CREATE POLICY author_update ON app.tickets FOR UPDATE TO bookleaf_app
  USING (author_id = app.actor_author_id()) WITH CHECK (author_id = app.actor_author_id());
--> statement-breakpoint
CREATE POLICY author_read ON app.ticket_messages FOR SELECT TO bookleaf_app
  USING (app.owns_ticket(ticket_id));
--> statement-breakpoint
CREATE POLICY author_insert ON app.ticket_messages FOR INSERT TO bookleaf_app
  WITH CHECK (sender_type = 'author' AND sender_id = app.actor_id() AND app.owns_ticket(ticket_id));
--> statement-breakpoint
CREATE POLICY author_read ON app.ticket_attachments FOR SELECT TO bookleaf_app
  USING (uploader_id = app.actor_id() OR (ticket_id IS NOT NULL AND app.owns_ticket(ticket_id)));
--> statement-breakpoint
CREATE POLICY author_insert ON app.ticket_attachments FOR INSERT TO bookleaf_app
  WITH CHECK (uploader_id = app.actor_id());
--> statement-breakpoint
CREATE POLICY author_update ON app.ticket_attachments FOR UPDATE TO bookleaf_app
  USING (uploader_id = app.actor_id())
  WITH CHECK (uploader_id = app.actor_id() AND (ticket_id IS NULL OR app.owns_ticket(ticket_id)));
--> statement-breakpoint
CREATE POLICY author_read ON app.ticket_events FOR SELECT TO bookleaf_app
  USING (visibility = 'public' AND app.owns_ticket(ticket_id));
--> statement-breakpoint
CREATE POLICY author_insert ON app.ticket_events FOR INSERT TO bookleaf_app
  WITH CHECK (actor_type = 'author' AND actor_id = app.actor_id() AND app.owns_ticket(ticket_id));
--> statement-breakpoint
CREATE POLICY author_read_published ON app.kb_sections FOR SELECT TO bookleaf_app
  USING (is_published);
--> statement-breakpoint
CREATE POLICY recipient_read ON app.notifications FOR SELECT TO bookleaf_app
  USING (recipient_id = app.actor_id());
--> statement-breakpoint
CREATE POLICY recipient_update ON app.notifications FOR UPDATE TO bookleaf_app
  USING (recipient_id = app.actor_id()) WITH CHECK (recipient_id = app.actor_id());
--> statement-breakpoint
CREATE POLICY author_own ON app.assist_conversations FOR ALL TO bookleaf_app
  USING (author_id = app.actor_author_id() AND profile_id = app.actor_id())
  WITH CHECK (author_id = app.actor_author_id() AND profile_id = app.actor_id());
--> statement-breakpoint
CREATE POLICY author_own ON app.assist_messages FOR ALL TO bookleaf_app
  USING (EXISTS (
    SELECT 1 FROM app.assist_conversations c
    WHERE c.id = conversation_id AND c.author_id = app.actor_author_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM app.assist_conversations c
    WHERE c.id = conversation_id AND c.author_id = app.actor_author_id()
  ));
--> statement-breakpoint

-- ─── updated_at maintenance ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'authors', 'profiles', 'books', 'tickets', 'ai_drafts', 'kb_sections', 'kb_examples',
    'incident_alerts', 'assist_conversations'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER touch_updated_at BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()',
      tbl
    );
  END LOOP;
END
$$;
--> statement-breakpoint

-- ─── Realtime fan-out ──────────────────────────────────────────────────────
-- NOTIFY is transactional: listeners only hear about changes that actually committed, and every
-- API instance LISTENing on the channel receives them (multi-instance safe). Payloads carry ids
-- only; clients refetch through the API, so no private data ever travels on this channel.
CREATE OR REPLACE FUNCTION app.iso_utc(ts timestamptz) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.notify_ticket_event() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  t_author uuid;
  t_number integer;
BEGIN
  SELECT author_id, number INTO t_author, t_number FROM app.tickets WHERE id = NEW.ticket_id;
  PERFORM pg_notify('bookleaf_events', json_build_object(
    'id', NEW.seq::text,
    'type', NEW.type,
    'ticketId', NEW.ticket_id,
    'ticketNumber', 'BL-' || t_number,
    'authorId', t_author,
    'recipientId', NULL,
    'visibility', NEW.visibility,
    'at', app.iso_utc(NEW.created_at)
  )::text);
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER ticket_events_notify AFTER INSERT ON app.ticket_events
  FOR EACH ROW EXECUTE FUNCTION app.notify_ticket_event();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.notify_notification() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  t_number integer;
BEGIN
  IF NEW.ticket_id IS NOT NULL THEN
    SELECT number INTO t_number FROM app.tickets WHERE id = NEW.ticket_id;
  END IF;
  PERFORM pg_notify('bookleaf_events', json_build_object(
    'id', 'n-' || NEW.id::text,
    'type', 'notification.created',
    'ticketId', NEW.ticket_id,
    'ticketNumber', CASE WHEN t_number IS NULL THEN NULL ELSE 'BL-' || t_number END,
    'authorId', NULL,
    'recipientId', NEW.recipient_id,
    'visibility', 'private',
    'at', app.iso_utc(NEW.created_at)
  )::text);
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER notifications_notify AFTER INSERT ON app.notifications
  FOR EACH ROW EXECUTE FUNCTION app.notify_notification();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.notify_alert() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  PERFORM pg_notify('bookleaf_events', json_build_object(
    'id', 'a-' || NEW.id::text || '-' || floor(extract(epoch FROM NEW.updated_at))::text,
    'type', CASE WHEN TG_OP = 'INSERT' THEN 'alert.created' ELSE 'alert.updated' END,
    'ticketId', NULL,
    'ticketNumber', NULL,
    'authorId', NULL,
    'recipientId', NULL,
    'visibility', 'internal',
    'at', app.iso_utc(NEW.updated_at)
  )::text);
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER incident_alerts_notify AFTER INSERT OR UPDATE ON app.incident_alerts
  FOR EACH ROW EXECUTE FUNCTION app.notify_alert();
