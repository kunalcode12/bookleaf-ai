# Architecture

## Shape of the system

| Tier | Technology                                                    | Responsibility                                                                                                                                               |
| ---- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Web  | Next.js 16 (App Router), React 19, Tailwind 4, TanStack Query | Author portal and support desk. Client-rendered data screens behind a thin server shell; `proxy.ts` forwards `/api/*` to the API so cookies stay first-party |
| API  | Node 24, Fastify 5, Zod 4                                     | Auth, RBAC, validation, business logic, realtime (SSE), background jobs, Leaf orchestration                                                                  |
| Data | Supabase Postgres (pgvector), Supabase Auth, Supabase Storage | Records, row-level security, embeddings, logins, attachments                                                                                                 |
| AI   | `@bookleaf/ai` (Leaf) → Gemini, Groq, OpenRouter              | Triage, drafts, Ask Leaf, thread summaries, embeddings, injection classifier                                                                                 |

Locally the same code runs on **PGlite** (Postgres compiled to WASM, with pgvector), an embedded identity provider and
disk storage, so `pnpm install && pnpm dev` needs nothing else. Tests use the same embedded database, migrations and
RLS, so they exercise the real SQL rather than mocks.

## Packages

```
contracts  ←  domain  ←  db
    ↑           ↑        ↑
    └──── ai ───┘        │
          ↑              │
   web ───┴───── api ────┘
```

- **contracts:** Zod schemas for every request and response. The API validates and documents with them (OpenAPI is
  generated from them); the web app types its client with them. One source of truth for both ends.
- **domain:** pure, framework-free BookLeaf rules: royalty payout windows (quarterly, 45 days, ₹1,000 minimum), SLA
  targets, the ticket state machine, urgency scoring, triage policy floors and caps, the knowledge base, and the
  validated sample dataset. Unit-tested in isolation.
- **db:** Drizzle schema in a private `app` schema (Supabase's auto-generated Data API only exposes `public`, so nothing
  is reachable except through this API), SQL migrations, the RLS policies, and `withActor()`.
- **ai:** Leaf, covered in [AI.md](AI.md).

## Request lifecycle

1. `onRequest`: security headers, CORS allowlist, optional origin secret, request id.
2. Auth hook (authenticated scopes): bearer token or httpOnly cookie → identity provider verifies it (Supabase JWKS,
   or HS256 for legacy projects) → profile lookup (cached 30 s) → `request.actor`. Cookie-authenticated writes must
   carry a trusted `Origin` (CSRF).
3. Role guard, registered once per scope: `/me/*` authors only, `/admin/*` team only. It runs before validation, so an
   author can't probe admin schemas.
4. Zod validation of params, query, headers and body (422 with per-field errors).
5. Service call inside `withActor(db, actor, fn)`: one transaction that sets `app.actor_role/id/author_id` and
   `SET LOCAL ROLE bookleaf_app`. Policies fail closed: a missing setting means no rows.
6. Errors map to RFC 9457 problem documents: domain errors to 4xx, Postgres constraint violations to 409/422, anything
   unexpected to a logged 500 with no internals leaked.

## Data model (core)

- `authors`, `books` (money in **paise**; `royalty_pending` is a _generated column_; CHECK constraints enforce
  `earned = copies × per-copy`, `paid ≤ earned`, and no sales before publication), `book_listings`.
- `profiles`: one per login; `role` and, for authors, the linked `author_id` (a CHECK keeps them consistent).
- `tickets`: effective category/priority **and** what Leaf proposed (`ai_category`, `ai_priority`), each with its
  source (`ai` | `rules` | `admin`), so overrides stay measurable. Triage signals, flags, injection report, SLA
  deadline, `thread_version` (bumps on every message; drafts record the version they answered), optimistic-lock
  `version`, idempotency key, embedding, full-text `tsvector`.
- `ticket_messages`, `ticket_notes` (separate table with **no author policy**: author code paths cannot select notes
  even by mistake), `ticket_attachments`, `ticket_events` (append-only audit trail; its insert trigger NOTIFYs).
- `ai_drafts` (versioned, with checks, grounding index, tokens, latency), `ai_runs` (every provider call), `kb_sections`
  - `kb_section_versions`, `kb_examples`, `notifications`, `incident_alerts`, `assist_*`.

## Background work

pg-boss on the same Postgres (no Redis). Queues: `ticket.triage`, `ticket.draft`, `kb.embed`, `alerts.scan`,
`maintenance.sweep`, `notify.email`.

- **Transactional enqueue:** creating a ticket and its triage job commit or roll back together.
- **Debounce:** triage and draft queues allow one waiting job per ticket, so a burst of follow-ups costs one AI call.
- **Lazy redrafting:** a draft is regenerated only when a specialist opens a ticket whose thread changed since the last
  draft. Follow-ups nobody has looked at yet cost no tokens.
- **Housekeeping** every 2 minutes re-queues triage that never ran (e.g. a crash between commit and pickup) and releases
  drafts stuck in "generating". An alert scan every 10 minutes looks for category spikes.
- Workers run inside the API (`WORKER_MODE=inline`) on a single small instance, or as `node dist/worker.js`.

## Realtime

Triggers on `ticket_events` and `notifications` call `pg_notify('bookleaf_events', {ids only})` **on commit**. Each API
instance holds one LISTEN connection and fans events out to its SSE clients through `canReceive()`: authors get public
events on their own tickets, admins everything, notifications go only to their recipient. The browser invalidates the
matching React Query caches and refetches through REST. Heartbeats every 25 s keep proxies from closing the stream;
the stream ends when the access token expires and the client refreshes and reconnects. If SSE is unavailable, the web
app polls every 20 s.

## Key decisions

| Decision                                                     | Why                                                                                     | Trade-off                                                               |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| API owns all data access (no Supabase client in the browser) | One place for validation, RBAC, audit and AI orchestration; keys never reach the client | An extra hop compared with direct Supabase queries                      |
| RLS _and_ API checks                                         | Defence in depth: a bug in one layer doesn't leak another author's data                 | Each query runs in a short transaction                                  |
| Postgres for jobs, realtime and vectors                      | One stateful dependency on free infrastructure                                          | Lower throughput ceiling than Redis or Kafka; ample at BookLeaf's scale |
| SSE instead of WebSockets                                    | One-way updates; works through Vercel's proxy and standard HTTP                         | Writes stay REST calls, which suits this app                            |
| Admin overrides are final                                    | Trust: a specialist's call must never be silently undone by a later AI pass             | Leaf's later reads are recorded but not applied                         |
| Deterministic fact sheet before the model                    | Numbers and dates are where LLMs fail most, and where mistakes cost the most trust      | Less "creative" freedom, deliberately                                   |
