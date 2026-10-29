# Deployment

Target setup, all on free tiers: **Supabase** (Postgres, Auth, Storage) · **Render** (API + workers) · **Vercel** (web).

```
browser ──► Vercel (Next.js) ──/api/*──► Render (Fastify API + pg-boss workers) ──► Supabase
```

## 1. Supabase

1. Create a project (choose the region closest to the API host, e.g. Mumbai or Singapore).
2. **Database → Connect → Session pooler**: copy the connection string (port **5432**, not the transaction pooler on
   6543, which can't hold `LISTEN` or prepared statements). This is `DATABASE_URL`.
3. **Settings → API keys**: copy the project URL (`SUPABASE_URL`), the publishable key (`SUPABASE_PUBLISHABLE_KEY`) and a
   secret key (`SUPABASE_SECRET_KEY`). Projects still on legacy JWT signing also need `SUPABASE_JWT_SECRET`.
4. **Authentication → Providers → Email**: keep email/password sign-in enabled. The seed creates the demo logins through
   the admin API, already confirmed, so no confirmation emails are sent.
5. Nothing else is needed. On first boot the API migrates (pgvector, schema, RLS, roles), creates the private
   `ticket-attachments` bucket, and seeds the dataset when the database is empty.

## 2. API on Render

`render.yaml` is a Blueprint: **New → Blueprint →** select the repository. Fill in the prompted variables:

| Variable                                                          | Value                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `DATABASE_URL`                                                    | Supabase session pooler string                                            |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | From step 1                                                               |
| `PUBLIC_APP_URL`                                                  | The Vercel URL, e.g. `https://bookleaf-support.vercel.app`                |
| `APP_ORIGINS`                                                     | Same as `PUBLIC_APP_URL` (comma-separate preview domains if needed)       |
| `PUBLIC_API_URL`                                                  | The Render URL, e.g. `https://bookleaf-api.onrender.com`                  |
| `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`            | Any subset; free keys from Google AI Studio, the Groq console, OpenRouter |
| `RESEND_API_KEY`                                                  | Optional; without it emails are logged                                    |
| `ORIGIN_SECRET`                                                   | Optional; a long random string, also set on Vercel as `API_ORIGIN_SECRET` |

The health check is `/health/ready`. Logs show `BookLeaf services started` with the active database, auth, storage,
queue and Leaf status.

Alternatives: `apps/api/Dockerfile` builds the same service for Railway, Fly.io or any container host
(`docker build -f apps/api/Dockerfile .`). For higher volume run the worker separately with `WORKER_MODE=off` on the API
and `node apps/api/dist/worker.js` as a second service.

## 3. Web on Vercel

1. **Add New → Project →** import the repository, then set **Root Directory** to `apps/web`. Vercel detects Next.js and
   pnpm.
2. Environment variables:

| Variable                   | Value                                     |
| -------------------------- | ----------------------------------------- |
| `API_ORIGIN`               | The Render URL (no trailing slash)        |
| `API_ORIGIN_SECRET`        | Same as the API's `ORIGIN_SECRET`, if set |
| `NEXT_PUBLIC_API_DOCS_URL` | `<API_ORIGIN>/docs`                       |

3. Deploy, then update `PUBLIC_APP_URL` and `APP_ORIGINS` on Render if the final domain differs.

## 4. After the first deploy

- Sign in as `aarav.mehta@bookleaf.test` / `BookLeaf@Admin1` and check that the queue shows 13 tickets and the sidebar
  says _Leaf is ready_.
- `GET <api>/health/ready` should report `database: ok`, `realtime: ok`, `ai: operational`.
- To keep the free Render instance warm during review, add the repository secret `API_HEALTH_URL` (the readiness URL);
  `.github/workflows/keep-alive.yml` pings it every 10 minutes.
- Re-seed from scratch: run `pnpm db:reset --yes` locally with the production `DATABASE_URL` and Supabase keys in
  `apps/api/.env`. Demo logins are re-used, and their passwords are reset to the seed values.

## Environment reference

Every variable is documented in [`apps/api/.env.example`](../apps/api/.env.example) and
[`apps/web/.env.example`](../apps/web/.env.example). The API validates its configuration at boot and refuses to start
with a readable list of problems (for example local auth in production, or missing Supabase keys).
