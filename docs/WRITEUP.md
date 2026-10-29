# Write-up: BookLeaf Author Support & Communication Portal

**The problem as I read it.** BookLeaf's support load is dominated by a few recurring questions (where's my royalty,
why isn't my book on Amazon, when will production finish), each answerable from data BookLeaf already has. Authors
need fast, specific, honest answers; the team needs to see what's urgent and not retype the same reply. So I
optimised for one thing: **every reply should contain the author's real numbers and BookLeaf's real policy, quickly,
without the AI ever being trusted with arithmetic or the final word.**

**Architecture.** A Next.js portal and a Fastify API in a typed monorepo, on Supabase (Postgres, Auth, Storage). The API
owns all data access: every query runs as the caller inside a transaction with Postgres row-level security, so tenant
isolation holds even if application code is wrong. Postgres also carries the job queue (pg-boss, enqueued in the same
transaction as the ticket), realtime (LISTEN/NOTIFY fanned out over Server-Sent Events) and vectors (pgvector), which
keeps it to one stateful dependency on free infrastructure. The same code runs locally on embedded Postgres with no
setup, and that is also what the 168 automated tests run against.

**AI strategy (Leaf).** I treated the model as the least reliable component and designed around that:

1. _Facts are computed, not generated._ The API derives a fact sheet per ticket: earned, paid, pending, the payout
   windows that closed without a payout, the next payout date, the ₹1,000 threshold status, the production stage. Leaf
   may state only those facts, and every amount, date and ISBN in a draft is verified against them, on the server and
   live in the editor while the specialist types.
2. _AI proposes, policy decides._ BookLeaf's written rules are code: ISBN errors and misprints get a priority floor,
   below-threshold balances get a cap, manipulation can never reach Critical. An admin override is final.
3. _Category-scoped, token-budgeted context:_ only the relevant policies, the closest calibration examples, and a
   windowed thread with a rolling summary. Drafts are regenerated lazily, only when a specialist opens a ticket whose
   thread changed. Each draft records its tokens next to the naive "send everything" baseline.
4. _Injection defence in depth:_ sanitising, unguessable delimiters, a 15-pattern detector plus an optional Prompt
   Guard classifier, structured outputs, a canary, and no autonomy. Leaf drafts; people send.
5. _Graceful degradation:_ free-tier models with routing, circuit breakers, rate limiting and mid-stream failover across
   Gemini, Groq and OpenRouter. With all of them down, tickets are still created, triage falls back to keyword rules,
   drafts to policy outlines, and every screen still works. CI runs this way, with no AI keys.

Model choice follows the task. Triage is short structured classification, so it goes to Flash-Lite with minimal
reasoning; drafts need good writing, so they go to Flash. The fallbacks run on independent infrastructure, so one
provider's outage or quota isn't BookLeaf's outage.

**Product decisions beyond the brief.** _Ask Leaf_ answers authors before they file a ticket and pre-writes the ticket
when a person is needed, which is the cheapest ticket of all. _Incident alerts_ notice when several authors report the
same thing (the seed includes an Amazon US outage), so the team fixes the cause once. The _knowledge base is editable
and versioned_, so policy changes reach Leaf without a deploy, and the team can "teach Leaf" from replies they're proud
of. _Insights_ holds the AI to account: override rates, draft adoption and edit distance, fallback rate, token savings,
SLA compliance and author satisfaction. If Leaf is wrong, it shows.

**Trade-offs.** I chose free tiers over the best models; the routing table makes upgrading a configuration change.
SSE over WebSockets suits one-way updates and works through Vercel's proxy. In-memory rate limits assume one API
instance. The royalty ledger is the provided snapshot, so payout windows are inferred from a single "last payout" date
and phrased as "needs checking" rather than "late".

**With more time:** a per-quarter payout ledger synced from the royalty system, so Leaf can say _which_ quarter is
unpaid; author self-service (bank details, metadata edits) to remove whole ticket classes; a paid model with
no-training terms; eval runs in CI on every prompt change; and WhatsApp and email as inbound channels.
