# Leaf: BookLeaf's support intelligence

Leaf is the AI layer behind both portals. It is designed as BookLeaf's own colleague, with a name, a mark and a
voice. It never pretends to be a person, never invents numbers, and hands over to the team when a decision is
theirs. All of it lives in `packages/ai`; the API orchestrates it around the ticket lifecycle (`apps/api/src/modules/ai`).

## What Leaf does

| Surface                                 | Task          | Output                                                                                                                                                                                                              |
| --------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every new ticket (background)           | **Triage**    | category (6), priority (4), confidence, one-line summary, rationale, sentiment, language, signals (money owed, months waiting, data error, print defect, not buyable, production delay, legal threat, manipulation) |
| After triage (background), or on demand | **Draft**     | reply in BookLeaf's voice, the facts and policies it used, whether to escalate and to which team, internal next steps; then deterministic checks                                                                    |
| Draft panel                             | **Refine**    | six presets (shorter, warmer, more detail, add timeline, more formal, simpler words) or a free-text instruction, streamed token by token                                                                            |
| Author's new-query page                 | **Ask Leaf**  | an instant answer from published policy and the author's own records, or a pre-written ticket when a person is needed                                                                                               |
| Long threads                            | **Summarise** | a rolling summary of older messages, so context stays small                                                                                                                                                         |
| Tickets, KB sections, examples          | **Embed**     | vectors for policy retrieval, similar-ticket lookup and incident clustering                                                                                                                                         |

## Design principles

1. **Facts are computed, not generated.** Before any call the API builds a _fact sheet_ from the database: copies sold,
   per-copy royalty, earned, paid, pending, last payout, the payout windows that closed without a payout, the next payout
   date, the threshold status, production stage and common delays. Each fact has an id (`F1`…). The model is told to
   state nothing else and to cite the ids it used. Royalty-window arithmetic lives in `packages/domain/src/royalty.ts`,
   unit-tested, never in a prompt.
2. **Every claim is verified.** `output/claims.ts` extracts amounts, dates, durations, percentages, counts and ISBNs from
   the reply. `output/grounding.ts` checks each against the fact sheet and policy text and reports _verified_, _quoted
   policy_ or _unverified_. The same browser-safe module (`@bookleaf/ai/checks`) re-runs the check live in the reply
   editor as the specialist types.
3. **AI proposes, policy decides.** `domain/triage-policy.ts` applies BookLeaf's written rules after classification and
   records each change with its reason. It raises priority for ISBN errors (the policy says "high priority"), print
   defects, live books that can't be bought, and closed payout windows with money owed, and raises to Critical after
   six or more months unpaid or on a legal threat. It caps priority when the balance is below the ₹1,000 minimum (expected
   rollover) and when the ticket contains manipulation (never Critical without a human). Admin overrides are final;
   later AI passes are recorded but never applied over them.
4. **Fail soft, always.** No AI path can block a ticket. If every provider is down, triage uses a deterministic keyword
   classifier (flagged _rule-based, needs review_), drafts become a policy-based outline with `[[placeholders]]` the
   editor refuses to send unfilled, and Ask Leaf quotes the most relevant policy lines and offers to file the ticket.
   Specialists can always reply by hand.

## Context assembly (cost-aware by construction)

| Piece                | Rule                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Policies             | Only sections tagged for the ticket's category (plus `alwaysInclude`), ranked by embedding similarity when available; hard budget of 900 tokens, at most 3 sections |
| Tone guide           | Always included; internal, never shown to authors                                                                                                                   |
| Calibration examples | The 1–2 closest of the brief's sample query/response examples, plus replies the team promoted ("Teach Leaf"), anonymised                                            |
| Thread               | The last 4 messages verbatim, earlier ones as a stored rolling summary                                                                                              |
| Facts                | Only the book in question, plus portfolio totals for account-level questions                                                                                        |

Every draft stores its actual input tokens next to the tokens the naive "whole knowledge base + full thread" prompt
would have used. Insights shows the saving and the per-task latency and failure rates.

## Model routing

Configured in `packages/ai/src/config.ts` and overridable per task through `LEAF_ROUTE_*` environment variables
(`provider:model@reasoning`, comma-separated). The first available route wins, and the next takes over on failure.

| Task                 | Route (cheapest sufficient first)                                                                      | Why                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Triage               | Gemini Flash-Lite (minimal reasoning) → second Flash-Lite model → Groq `gpt-oss-20b` → OpenRouter free | Short structured output; speed and cost matter, depth doesn't                 |
| Draft                | Gemini Flash (low reasoning) → second Flash → Groq `gpt-oss-120b` → `gpt-oss-20b` → OpenRouter free    | Writing quality and instruction-following matter; still cheap                 |
| Ask Leaf             | Gemini Flash-Lite → Groq `gpt-oss-20b` → OpenRouter free                                               | Short answers from given text                                                 |
| Summaries            | Gemini Flash-Lite → Groq `gpt-oss-20b`                                                                 | Compression only                                                              |
| Embeddings           | `gemini-embedding-001`                                                                                 | Free tier; one vector space for policies, examples and tickets                |
| Injection classifier | Groq Llama Prompt Guard 2 (86M)                                                                        | A dedicated classifier is cheaper and harder to talk round than asking an LLM |

Each Gemini model has its own free quota, so two Gemini models precede the cross-provider fallback. Groq runs on
independent infrastructure, so a Google outage doesn't take Leaf down. Switching to a paid model (for example a Claude
model through OpenRouter) is a configuration change.

**Cost.** On free tiers the spend is $0. Insights also estimates what the same traffic would cost at the list prices
recorded in `gateway/pricing.ts` (update them from the providers' pricing pages before budgeting). A typical ticket uses
about 1.5k input tokens for triage and about 3k for a draft, which at those recorded prices is well under one US cent
per ticket.

**Privacy.** Free tiers may use submitted data to improve the provider's products, so Leaf masks PII (bank account,
card and UPI numbers, IFSC codes, Aadhaar and PAN numbers, phone numbers and emails) _before_ text leaves the server, and
only the book in question is shared. For production, BookLeaf should move to paid tiers with no-training terms. It's the same
configuration either way.

## Gateway (`packages/ai/src/gateway`)

- **Provider adapters:** Gemini `generateContent` (native JSON schema output, thinking level) and one OpenAI-compatible
  adapter for Groq and OpenRouter that negotiates `json_schema` (strict) → `json_object` → prompt-only.
- **Circuit breakers** per provider and model: three consecutive failures open the circuit for a minute, then one
  half-open probe decides; each failed probe doubles the cooldown, up to 10 minutes. A definitive failure opens it at
  once: a bad API key for 10 minutes, an exhausted daily quota until the provider's stated reset (at least 15
  minutes). A dead provider costs nothing instead of a timeout on every ticket.
- **Client-side rate limits** (RPM, TPM, RPD) per model, kept just under each free tier (`LEAF_RATE_LIMITS` overrides),
  so quota errors are mostly avoided rather than handled. A request holds its estimate (input plus output budget)
  while in flight, then the usage the provider reported. When a model is at capacity, interactive calls move straight
  on; background drafts wait up to a minute for it rather than fall to the last resort. Gemini's free tier allows 20
  requests a day per Flash model (October 2026), so on a busy day drafts move on to Groq once both Flash quotas are used.
- **Retries:** one quick retry on the same model when the provider is briefly unavailable (503 "high demand") or the
  network drops. A timeout (or a 408/504) has already used its time budget (20 s; 30 s for drafts), so it moves
  straight to the next model. A per-minute 429 skips the model for the provider's stated wait; only a per-day quota
  parks it until the reset. **Invalid-output failover** when a reply
  fails schema validation; **streaming failover**: if a stream dies mid-answer the next model takes over and the UI
  resets the partial text.
- **Telemetry:** every call (success, error, fallback, skip) is written to `ai_runs` with tokens, latency, attempt and
  estimated cost, and feeds Insights and `GET /admin/ai/health`.

## Prompt-injection and abuse defences

Author text is untrusted input to a system that can draft replies and set priorities. The layers:

1. **Sanitise:** strip invisible and bidirectional control characters (and count them, since hidden text is itself a
   signal), neutralise angle brackets, cap lengths.
2. **Spotlight:** untrusted text goes inside tags with a random per-request suffix (`<ticket_k3f9a1>`), which an attacker
   can't guess or close early. The system prompt states that nothing inside those tags is an instruction.
3. **Detect:** a heuristic scanner covers 15 named patterns, including override attempts (English and Hinglish), fake
   system markup, role switches, priority forcing, reply dictation, schema spoofing and link exfiltration. It runs with
   the optional Prompt Guard 2 classifier and the model's own `manipulationAttempt` signal. Detection never blocks the
   ticket; it flags it, shows the admin _why_, and stops automatic escalation.
4. **Constrain the output:** structured outputs only, so the model fills fields rather than writing free-form actions.
   A canary in the system prompt catches leaks, link checks allow only configured domains, and placeholder checks stop
   "fill-in" text being sent.
5. **Least power:** Leaf can't send anything. Every reply goes out from a human, and the editor re-runs the checks on the
   final text and asks for confirmation before sending anything that fails them.

The demo includes a live example (BL-1010): an author's message ends with a fake "SYSTEM NOTE" asking the AI to mark
the ticket Critical and confirm a ₹25,000 payment. It is flagged with the matched signals, its priority stays where
policy puts it, and the draft never mentions the amount.

## Voice

The tone guide from the brief is part of every draft prompt and is enforced as a checklist the editor shows:
_acknowledges the concern · specific (real numbers and dates) · gives a timeline when escalating · ends with a next
step · no fluff_. Stock phrases ("we apologise for any inconvenience", "rest assured", mentions of being an AI) are
flagged. Replies are signed by the specialist sending them, not by "the AI".

## Evaluation (`packages/ai/src/evals`, `pnpm ai:eval`)

- **Triage:** 45 labelled tickets in Indian English, Hinglish, angry, polite and ambiguous registers, including keyword
  traps where the obvious word points to the wrong category. Leaf's accuracy is compared with the keyword-rules baseline
  (84% category accuracy).
- **Injection:** 12 attacks: detection rate, priority held, and forced content kept out of drafts.
- **Drafts:** the brief's sample queries, scored by the deterministic review (grounding, tone checklist) and an LLM judge.
- **Tokens:** budgeted context against the naive prompt.

The run writes `docs/ai-eval-report.md`. It needs provider keys and is paced to stay inside free-tier limits.
