# BookLeaf Support API

REST over JSON, versioned under `/api/v1`. The authoritative reference is generated from the same Zod schemas the
server validates with:

- Interactive reference (Scalar): `GET /docs`
- OpenAPI 3.1: `GET /openapi.json`, checked in at [`api/openapi.json`](api/openapi.json)
- Postman: [`api/bookleaf.postman_collection.json`](api/bookleaf.postman_collection.json) (set `baseUrl`, call
  _Auth → token_, paste the `accessToken` into the collection's bearer auth)

## Conventions

| Topic       | Rule                                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resources   | Plural nouns, kebab-case paths (`/knowledge-base/sections`), camelCase JSON, ISO 8601 timestamps with offset, dates as `YYYY-MM-DD`                         |
| Audiences   | `/me/*` for authors (every query scoped to the caller), `/admin/*` for the BookLeaf team, `/auth/*` public. The role guard runs before validation           |
| Money       | `{ "amountMinor": 357000, "currency": "INR" }`, i.e. integer paise, never floats                                                                            |
| Tickets     | Addressable by UUID or reference: `/admin/tickets/BL-1042`                                                                                                  |
| Pagination  | Cursor-based: `?limit=25&cursor=…` → `{ data, pageInfo: { nextCursor, hasMore } }`. Cursors are bound to the filter set                                     |
| Idempotency | `Idempotency-Key: <uuid>` on ticket creation and replies. A retry returns the original result (`200` + `Idempotent-Replayed: true`) instead of a duplicate  |
| Concurrency | Admin ticket reads return `ETag: W/"<version>"`. Send it as `If-Match` on `PATCH`; if a colleague changed the ticket you get `412` with the current version |
| Caching     | `Cache-Control: no-store` on every response (private data must never be cached by a CDN)                                                                    |
| Tracing     | Every response carries `X-Request-Id`; errors include it as `requestId`                                                                                     |

## Authentication

| Client     | Flow                                                                                                                                                                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser    | `POST /api/v1/auth/login` `{email, password}` sets httpOnly cookies (`__Host-` / `__Secure-` prefixed on HTTPS, SameSite=Lax). The refresh cookie is scoped to `/api/v1/auth` and rotated on every `POST /auth/refresh`. Cookie-authenticated writes must come from an allowed `Origin` |
| API client | `POST /api/v1/auth/token` returns `{ accessToken, refreshToken, expiresAt, user }`. Send `Authorization: Bearer <accessToken>` and refresh with `POST /auth/refresh {refreshToken}`                                                                                                     |

`GET /auth/session` returns the signed-in user. `POST /auth/logout` revokes the refresh token. `GET /auth/demo-accounts`
lists demo personas when `DEMO_MODE=true`.

## Errors

Every error is an RFC 9457 problem document, `Content-Type: application/problem+json`:

```json
{
  "type": "https://bookleaf.support/problems/validation-failed",
  "title": "Unprocessable Content",
  "status": 422,
  "detail": "Some fields need your attention.",
  "instance": "/api/v1/me/tickets",
  "code": "VALIDATION_FAILED",
  "requestId": "019f2609-e87e-43c6-9255-990e4bc660fa",
  "errors": [{ "path": "subject", "message": "Subject needs at least 5 characters", "code": "too_small" }]
}
```

Clients branch on `code`, which is stable:

| Status    | Codes                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 400       | `BAD_REQUEST` (malformed JSON, cancelled draft)                                                                                         |
| 401       | `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS` (identical for unknown emails: no account enumeration)                        |
| 403       | `FORBIDDEN` (wrong role), `CSRF_REJECTED`                                                                                               |
| 404       | `NOT_FOUND`, which is also returned for another author's records, so existence never leaks                                              |
| 409       | `INVALID_STATUS_TRANSITION` (with `meta.allowedTransitions`), `TICKET_CLOSED`, `ASSIGNMENT_CONFLICT` (with `meta.assignee`), `CONFLICT` |
| 412       | `PRECONDITION_FAILED` (stale `If-Match`)                                                                                                |
| 413 / 415 | `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`                                                                                           |
| 422       | `VALIDATION_FAILED` with per-field `errors` (also for constraint violations caught by the database)                                     |
| 429       | `RATE_LIMITED` with `Retry-After` and `meta.retryAfterSeconds`                                                                          |
| 503       | `AI_UNAVAILABLE`, `SERVICE_UNAVAILABLE`                                                                                                 |

## Endpoints

### Authors (`/api/v1/me`)

| Method | Path                                                          | Purpose                                                                                                                        |
| ------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/books`                                                      | My books with sales, royalty ledger, payout status and production stage, plus portfolio totals                                 |
| GET    | `/books/{bookId}`                                             | One of my books                                                                                                                |
| GET    | `/tickets?status=active\|open\|in_progress\|resolved\|closed` | My tickets, newest activity first                                                                                              |
| POST   | `/tickets`                                                    | Submit a query (`bookId` null = General / Account Level). Returns `201` + `Location`; triage happens in the background         |
| GET    | `/tickets/{ref}`                                              | Ticket with the conversation and status timeline (marks replies read)                                                          |
| POST   | `/tickets/{ref}/messages`                                     | Reply; a resolved ticket reopens                                                                                               |
| POST   | `/tickets/{ref}/feedback`                                     | Rate a resolved ticket 👍/👎 with an optional comment                                                                          |
| POST   | `/assist`                                                     | Ask Leaf: an instant answer from published policy and my records                                                               |
| POST   | `/assist/feedback`                                            | Mark an Ask Leaf answer helpful or not                                                                                         |
| POST   | `/attachments`                                                | Get a signed upload URL (JPG/PNG/WebP/PDF, ≤ 10 MB), then PUT the file and pass `attachmentId` when creating a ticket or reply |

### Team (`/api/v1/admin`)

| Method             | Path                              | Purpose                                                                                                                                                                                                                              |
| ------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET                | `/tickets`                        | Queue: `status`, `category`, `priority` (comma lists), `assignee=me\|unassigned\|<id>`, `createdFrom`, `createdTo`, `flag`, `sla=breached\|at_risk`, `q` (full text or BL number), `sort=urgency\|newest\|oldest\|updated\|priority` |
| GET                | `/tickets/stats`                  | Counters: unresolved, critical, overdue, due soon, unassigned, mine, needs review, manipulation attempts                                                                                                                             |
| GET                | `/tickets/{ref}`                  | Workspace: thread, notes, timeline, Leaf triage and draft, author context, similar tickets, allowed transitions, `ETag`                                                                                                              |
| PATCH              | `/tickets/{ref}`                  | Change status, or override category/priority (`If-Match` recommended)                                                                                                                                                                |
| PUT                | `/tickets/{ref}/assignee`         | Assign to `"me"`, a colleague, or `null`; `force: true` takes over                                                                                                                                                                   |
| POST               | `/tickets/{ref}/messages`         | Reply to the author (`draftId` to credit Leaf, `resolve: true` to resolve in one step)                                                                                                                                               |
| GET / POST         | `/tickets/{ref}/notes`            | Internal notes, never visible to the author                                                                                                                                                                                          |
| GET                | `/tickets/{ref}/draft`            | Leaf's latest draft                                                                                                                                                                                                                  |
| POST               | `/tickets/{ref}/draft`            | Regenerate or refine (`preset`, `instruction`). With `Accept: text/event-stream` it streams `start` → `delta`* → `done` (`reset` on mid-stream failover, `error` on failure)                                                         |
| POST               | `/tickets/{ref}/triage`           | Re-run Leaf triage (`202`)                                                                                                                                                                                                           |
| GET                | `/ai/health`                      | Provider status, circuits and routes                                                                                                                                                                                                 |
| GET                | `/team`                           | Team members (for assignment)                                                                                                                                                                                                        |
| GET                | `/authors`, `/authors/{id}`       | Author directory with catalogue, royalty position and tickets                                                                                                                                                                        |
| GET / PATCH        | `/knowledge-base/sections[/{id}]` | Policies Leaf answers from; edits are versioned and re-embedded                                                                                                                                                                      |
| GET / POST / PATCH | `/knowledge-base/examples[/{id}]` | Tone examples; POST promotes a sent reply (anonymised)                                                                                                                                                                               |
| GET                | `/insights?days=7..90`            | Volume, responsiveness, SLA, satisfaction, Leaf quality and usage                                                                                                                                                                    |
| GET / PATCH        | `/alerts[/{id}]`                  | Incident alerts (similar-ticket clusters, category spikes): acknowledge or resolve                                                                                                                                                   |
| POST               | `/attachments`                    | Signed upload URL for reply attachments                                                                                                                                                                                              |

### Shared (any signed-in user)

| Method | Path                            | Purpose                                                                                                                                                      |
| ------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/events`                       | Server-Sent Events: `event: <type>` with `data: {id, type, ticketId, ticketNumber, at}`. Thin notifications only; refetch through REST. Heartbeat every 25 s |
| GET    | `/notifications`                | My notifications and unread count                                                                                                                            |
| POST   | `/notifications/read`           | Mark some (`ids`) or all read                                                                                                                                |
| GET    | `/health/live`, `/health/ready` | Liveness; readiness (database, realtime, AI, worker mode)                                                                                                    |

## Rate limits

| Scope                     | Limit          |
| ------------------------- | -------------- |
| Any route, per IP         | 600 / minute   |
| Sign-in, per IP and email | 10 / 5 minutes |
| New tickets, per author   | 10 / hour      |
| Author replies            | 30 / hour      |
| Ask Leaf                  | 20 / hour      |
| Attachment uploads        | 30 / hour      |
| Admin replies             | 60 / minute    |
| Draft regeneration        | 12 / minute    |
