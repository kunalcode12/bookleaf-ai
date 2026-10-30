# Deployment

Target setup, all on free tiers: **Supabase** (Postgres, Auth, Storage) · **Render** (API + workers) · **Vercel** (web).

```
browser ──► Vercel (Next.js, fra1) ──/api/*──► Render (Fastify API + pg-boss workers, Frankfurt) ──► Supabase (eu-west-1)
```

Keep the three in one part of the world. Each API request makes several database round trips, so the API must sit
next to the database: Frankfurt ↔ Ireland is ~20 ms per round trip, Singapore ↔ Ireland ~170 ms. The browser makes
one round trip to the API per request, so distance there matters far less. A Render region can't be changed later.

The repository must stay **private** (the assignment is confidential). Render and Vercel both deploy from private
GitHub repositories.

## 1. Supabase

1. Create a project in the region you want (this deployment uses **eu-west-1, Ireland**, next to Render Frankfurt).
2. **Connect → Session pooler**: copy the connection string. It looks like
   `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres` and is
   `DATABASE_URL`. Use the session pooler (port **5432**): the transaction pooler (6543) can't hold `LISTEN` or prepared
   statements, and the direct host `db.<project-ref>.supabase.co` is IPv6-only, which Render can't reach.
3. **Project Settings → API Keys**: copy the project URL (`SUPABASE_URL`), the publishable key
   (`SUPABASE_PUBLISHABLE_KEY`, `sb_publishable_…`) and a secret key (`SUPABASE_SECRET_KEY`, `sb_secret_…`). Leave
   `SUPABASE_JWT_SECRET` unset: projects on JWT signing keys are verified against the project's JWKS. Only projects
   still on the legacy shared secret need it.
4. **Authentication → Sign In / Providers**: keep Email enabled and turn **off** "Allow new users to sign up". BookLeaf
   accounts are created by the team (the seed uses the admin API, which still works), and nobody should be able to
   register themselves against the project's public key.
5. Nothing else is needed. On first boot the API migrates (pgvector, schema, row-level security, the restricted
   `bookleaf_app` role), creates the private `ticket-attachments` bucket, and seeds the dataset when the database is
   empty.

## 2. API on Render

**New → Blueprint →** connect GitHub and select the repository. Render reads `render.yaml`: one free web service,
`bookleaf-api`, in Frankfurt, with the build, start and health-check commands and the non-secret settings. Fill in the
prompted variables:

| Variable                                                          | Value                                                                                    |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                    | The Supabase **session pooler** string from step 1.2                                     |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | From step 1.3                                                                            |
| `PUBLIC_APP_URL`                                                  | The web URL you'll use on Vercel, e.g. `https://bookleaf-support.vercel.app`             |
| `APP_ORIGINS`                                                     | Same as `PUBLIC_APP_URL` (comma-separate extra origins such as preview domains)          |
| `PUBLIC_API_URL`                                                  | `https://bookleaf-api.onrender.com` (Render shows the exact URL once the service exists) |
| `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`            | Any subset; free keys from Google AI Studio, the Groq console and OpenRouter             |
| `RESEND_API_KEY`                                                  | Optional; without it emails are written to the log                                       |
| `EMAIL_REDIRECT_TO`                                               | Optional; the Resend account's email address (see below)                                 |
| `ORIGIN_SECRET`                                                   | Optional; a long random string, also set on Vercel as `API_ORIGIN_SECRET`                |

Apply. The first build takes a few minutes; the service is live when the log shows `BookLeaf services started` and
`GET https://<api>/health/ready` returns `database: ok`, `realtime: ok`.

The Leaf settings (`LEAF_ROUTE_*`, `LEAF_EMBEDDING_MODEL`, `LEAF_GUARD_MODEL`, `LEAF_RATE_LIMITS`) are optional and
not in the blueprint: the defaults are the routes in [AI.md](AI.md). Override one only to change a route or quota, for
example `LEAF_ROUTE_DRAFT=groq:openai/gpt-oss-120b@low,gemini:gemini-3.6-flash@low` to draft on Groq first.

**Email.** Until a sending domain is verified in Resend, mail can only come from `onboarding@resend.dev` (the
blueprint's `EMAIL_FROM`) and Resend delivers only to the account's own address; mail to other recipients is refused
and logged, never retried. For the demo, set `EMAIL_REDIRECT_TO` to that address: every notification is delivered
there, with the intended recipient in the subject. With a verified domain, set `EMAIL_FROM` to an address on it and
clear `EMAIL_REDIRECT_TO`.

Alternatives: `apps/api/Dockerfile` builds the same service for Railway, Fly.io or any container host
(`docker build -f apps/api/Dockerfile .`). For higher volume run the worker separately with `WORKER_MODE=off` on the API
and `node apps/api/dist/worker.js` as a second service (mind the pooler's connection budget: each process uses up to
`DATABASE_POOL_MAX` + 3 connections).

## 3. Web on Vercel

**Add New → Project →** import the repository and set **Root Directory** to `apps/web`. Vercel detects Next.js and
pnpm; leave the build and install commands at their defaults. `apps/web/vercel.json` puts its functions in Frankfurt
(`fra1`), next to the API. Add these environment variables, then **Deploy**:

| Variable                   | Value                                                                        |
| -------------------------- | ---------------------------------------------------------------------------- |
| `API_ORIGIN`               | The Render URL, e.g. `https://bookleaf-api.onrender.com` (no trailing slash) |
| `API_ORIGIN_SECRET`        | Same as the API's `ORIGIN_SECRET`, if set                                    |
| `NEXT_PUBLIC_API_DOCS_URL` | `<API_ORIGIN>/docs`                                                          |

If the production domain differs from the `PUBLIC_APP_URL` you gave Render, update `PUBLIC_APP_URL` and `APP_ORIGINS`
on Render (**Environment → Save, rebuild, and deploy**). `PUBLIC_APP_URL` builds the links in notification emails and
turns on secure cookies; `PUBLIC_API_URL` is the server address in the API reference.

The browser only ever talks to the Vercel domain: `/api/*` is forwarded to Render by `src/proxy.ts`, so the session
cookies are first-party and the API host and keys never reach the client.

## 4. After the first deploy

- Sign in as `aarav.mehta@bookleaf.test` / `BookLeaf@Admin1` (or use the persona buttons on the login page): the queue
  shows 13 tickets, most already triaged by Leaf with a draft waiting, and the sidebar says _Leaf is ready_.
- Sign in as `priya.sharma@email.com` / `BookLeaf@Author1` in another browser, raise a ticket with a photo attached,
  and watch it appear on the desk without a refresh, triaged and then drafted within a minute.
- `GET https://<api>/health/ready` reports `database: ok`, `realtime: ok`, `ai: operational` (`degraded` just means a
  provider is resting and Leaf is using its fallbacks).
- **Keep it warm.** Render's free instance sleeps after 15 minutes without traffic, and the next request then waits
  ~30–60 s. During review, point a free monitor such as [cron-job.org](https://cron-job.org) or
  [UptimeRobot](https://uptimerobot.com) at `https://<api>/health/ready` every 5–10 minutes. The bundled
  `.github/workflows/keep-alive.yml` does the same once the repository **variable** `API_HEALTH_URL` is set, but on a
  private repository each run bills at least one Actions minute (~3,000 a month at its schedule, over the free 2,000).
- **Gemini quotas.** The free tier allows 20 requests a day per Flash model. Past that, drafts are written by Groq;
  the AI health page shows which provider is resting and why.
- **Re-seed from scratch:** run `pnpm db:reset --yes` locally with the production `DATABASE_URL` and Supabase keys in
  `apps/api/.env`. Demo logins are reused and their passwords reset to the seed values; the next API start triages and
  drafts the demo tickets.
- After the evaluation, rotate the Supabase secret key and database password and the AI and Resend keys.

## Environment reference

Every variable is documented in [`apps/api/.env.example`](../apps/api/.env.example) and
[`apps/web/.env.example`](../apps/web/.env.example). The API validates its configuration at boot and refuses to start
with a readable list of problems (for example local auth or the embedded database in production, or missing Supabase
keys).
