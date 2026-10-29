# Security model

## Assets and threats

| Asset                                      | Main threats                                                                                 | Controls                                                                                                                                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each author's books, royalties and tickets | Another author reading them (IDOR); a bug in a query                                         | API scoping **and** Postgres row-level security; 404 (never 403) for others' records                                                                                                        |
| Internal notes and Leaf internals          | Leaking to authors                                                                           | Notes in a separate table with no author policy; author DTOs never include triage, drafts or confidence; internal events filtered from the author's realtime stream                         |
| Sessions                                   | Theft, CSRF, fixation                                                                        | httpOnly, Secure, SameSite=Lax cookies with `__Host-`/`__Secure-` prefixes; refresh token rotated on use and scoped to `/api/v1/auth`; `Origin` check on cookie-authenticated writes        |
| AI behaviour                               | Prompt injection steering priority or replies; data exfiltration through links; prompt leaks | See [AI.md § defences](AI.md#prompt-injection-and-abuse-defences): sanitising, nonce spotlighting, detectors, structured outputs, canary, link allowlist, priority caps, human-only sending |
| Secrets (AI keys, Supabase secret key)     | Exposure to the browser or the repository                                                    | Server-side environment variables only, validated at boot; the browser talks only to the web origin; nothing is prefixed `NEXT_PUBLIC_` except a docs link; `.env*` ignored by git          |
| Attachments                                | Malware or oversized uploads; public links                                                   | Type and size allowlist enforced when the upload is requested _and_ by the storage bucket; private bucket; short-lived signed URLs; files can only be attached by their uploader            |
| Availability                               | Credential stuffing, abuse, AI quota exhaustion                                              | Per-IP and per-account login throttling; per-user limits on writes and AI endpoints; client-side AI rate limits; circuit breakers                                                           |

## Row-level security

Every request runs in a transaction that records the actor (`app.actor_role`, `app.actor_id`, `app.actor_author_id`)
and switches to the restricted `bookleaf_app` role (`SET LOCAL ROLE`), so RLS applies even though the connection pool
logs in as the table owner. Policies are written to **fail closed**: an unset actor matches nothing. Authors can read
their own author row, books and listings, read and write their own tickets, messages and attachments, and see only
public events. Admins and the background worker act as staff. Settings are transaction-local, so pooled connections
never carry one user's identity into another request. `apps/api/test/access.test.ts` verifies isolation through HTTP
**and** directly against the database role.

All tables live in a private `app` schema. Supabase's auto-generated Data API only exposes `public`, so there is no
second way in.

## Input handling

- Zod validation on every route (params, query, headers, body) with length limits shared with the web forms.
- JSON bodies are capped at 256 KB. Unknown content types are rejected.
- Database constraints back the important invariants (money ledger, state consistency, lengths), so even a code bug
  can't write an impossible royalty ledger.
- Ticket text is rendered as text, never as HTML.

## Headers and transport

Helmet (HSTS in production, `nosniff`, a referrer policy, `X-Frame-Options: DENY` on the web), a CORS allowlist of
configured origins, `Cache-Control: no-store` on every API response, and a Content-Security-Policy on the web app in
production (same-origin scripts and connections only, plus signed uploads to Supabase Storage). An optional shared secret (`ORIGIN_SECRET` / `API_ORIGIN_SECRET`) makes the API reject calls that don't
come through the web tier.

## Logging

Structured JSON logs with a request id on every line. Authorization headers, cookies, passwords, tokens and API keys
are redacted at the logger. AI telemetry stores token counts, latency and outcomes, not ticket text.

## Known gaps

- Rate limits are per instance (in memory); multi-instance deployments need a shared store.
- No virus scanning of attachments; files are type-restricted and only ever served as downloads.
- The local identity provider is for development and tests only. Configuration validation refuses to start in
  production with it.
