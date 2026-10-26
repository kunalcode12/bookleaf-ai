-- pgvector powers semantic retrieval (KB sections, similar tickets, incident clustering).
-- On Supabase it may already be enabled (in the `extensions` schema); otherwise install it here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    CREATE EXTENSION vector;
  END IF;
END
$$;
