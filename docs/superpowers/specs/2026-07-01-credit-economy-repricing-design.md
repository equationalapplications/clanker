# Credit Economy Repricing (July 2026) — Design Spec

**Date:** 2026-07-01
**Status:** Draft
**Supersedes (partially):** `2026-07-01-credit-improvements-design.md` (PR #506) documented cloud-agent
`spendCredit` as "not modified — it only ever spends 1, which cannot fragment." This spec changes
that: live voice moves from 1 to 5 credits/tick, which *can* span multiple `credit_transactions`
rows, so cloud-agent needs the same multi-row FIFO allocator functions/ already has.
**Interacts with:** `2026-07-01-live-voice-credit-reconciliation-design.md` (PR pending) assumed the
live-voice connect gate stays `≥ 2` forever ("No change to the live-voice billing backend or the
≥ 2 connect gate"). That assumption is now stale — this spec raises the gate to `≥ 5`. The
reconciliation spec's actual mechanism (client-side badge sync via `USAGE_SNAPSHOT_RECEIVED`) is
unaffected; only the gate constant and the "~5 min runway" UI comment context change.

---

## Overview

Finalized per-action credit pricing, replacing today's mostly-flat 1-credit-per-call model with
per-mechanism costs sized to target margins. Two actions that are currently **entirely unbilled**
(`summarizeText`, `generateEmbedding`) become billed. Live voice and the cloud-agent tool loop move
from flat-per-call billing to metered billing (per tick / per internal loop iteration).

| Action | Path | Old cost | New cost | Target margin |
|---|---|---|---|---|
| Live Voice | cloud-agent `/agent/live` (wsLiveAgentHandler) | 1 / 60s tick | **5 / 60s tick** | ~74% |
| Agent Turn | cloud-agent `POST /agent/run` | 1 / turn (flat) | **1 / internal loop, max 5** | ~61%+ |
| Doc Conversion | `convertDocumentText` | 1 | **2** | ~74% |
| Image Gen | `generateImage` | 1 | **2** | ~77% |
| Embeddings | `generateEmbedding` | unbilled | **1 / 50k chars** (`Math.ceil`) | ~98% |
| Summarization | `summarizeText` | unbilled | **1 / call** | Variable (high) |
| Text Chat (Grounded) | `generateReply`, no explicit `tools` (default googleSearch) | 1 | **3** | ~87% |
| Text Chat (Standard) | `generateReply`, explicit `tools` passed | 1 | **1** | ~70% |
| Wiki Sync / DOCX / memory write/heal | `wikiSync`, `wikiLlm`, `memoryWrite`, `memoryHeal` | 1 | **1 (no change)** | ~99% (subsidizer) |

**Rollout:** hard cutover. New rates apply the moment each service deploys, including any live-voice
call already connected — Cloud Run replaces the running instance on deploy, dropping the websocket
anyway, so an in-flight session surviving the deploy boundary isn't a real scenario worth
engineering around. No rate-versioning or grandfathering.

---

## A) Firebase Callables (`functions/src`)

`functions/src/services/creditService.ts` already supports variable `amount` via
`spendCredits(userId, amount): Promise<CreditSpendAllocation[] | null>` — no service-layer change
needed here, only call-site changes.

| Function | File | Change |
|---|---|---|
| `convertDocumentText` | `convertDocumentText.ts:187` | `spendCredits(userId, 1)` → `spendCredits(userId, 2)` |
| `generateImage` | `generateImage.ts:127` | `spendCredits(userId, 1)` → `spendCredits(userId, 2)` |
| `summarizeText` | `summarizeText.ts` | **New.** Add `spendCredits(userId, 1)` before the Vertex call; `refundCredit` in the existing `catch` around `generateSummary` (handler.ts:155-163). Currently fully unbilled — no chunking exists (single call, ≤16k chars in, one summary out), so the whole call is billed as 1 unit. No block-splitting added. |
| `generateEmbedding` | `generateEmbedding.ts` | **New.** Add `spendCredits(userId, Math.ceil(text.length / 50_000))` before the Vertex call; `refundCredit` on failure. `MAX_TEXT_LENGTH` stays `8_000` (unchanged) — the formula always resolves to `1` under that cap today. Shipped as-is anyway: future-proofing for when the cap is raised (e.g. larger-context embedding model or chunking is added later), at which point multi-credit billing activates automatically with no further billing-logic change. |
| `generateReply` | `generateReply.ts:535,539,650` | Cost keys off the existing grounded/standard distinction (`generateReply.ts:310-313`, `buildToolsForRequest`): explicit `tools` → standard → 1; no `tools` (defaults to `googleSearchManifest`) → grounded → 3. **Signature change required:** the spend lives in `chargeForReply(userId, credits)` (line 535-539), which currently has **no access to `tools`**. `tools` is parsed in the handler (line 569) and `chargeForReply` is called at line 650. Thread an `isGrounded: boolean` (or the `tools` value) param into `chargeForReply` — computed at the call site as `!tools || tools.length === 0` — and spend `isGrounded ? 3 : 1`. This is not a one-line change at the spend site; it's a small signature plumb from handler → `chargeForReply`. |

All four use the existing spend-first / refund-in-catch pattern already proven in
convertDocumentText, generateImage, and generateReply — no new error-handling shape.

---

## B) Cloud-agent HTTP — `POST /agent/run`

### Current behavior

`cloud-agent/src/index.ts:228-331`. One flat credit spent **before** `runAgentReal` runs (line 261),
refunded whole on pre-agent failure (line 287) or ADK error (line 299). `runAgentReal`
(`index.ts:65-138`) drives the ADK loop via `runner.runAsync(...)` and a `for await (const event of
events)` loop (lines 111-132) with no app-level iteration cap — looping is entirely delegated to the
ADK library.

### New behavior

Move credit deduction **inside** the `for await` loop. On each iteration that yields a tool-call
(`functionCall` part detected, mirroring the existing `toolCalls.push(fc.name)` logic at line 119),
spend 1 credit via `cs.spendCredit(userId)` and increment `loopCount`.

- **Loop cap — hard stop.** At `loopCount === 5`, stop consuming the event stream (`events.return?.()`
  if the ADK async generator supports it, else `break`) instead of letting ADK continue. Force
  whatever reply/summary is available at that point rather than an additional tool-call round. This
  bounds both cost and latency at the app level, not just the billing.
- **Mid-loop insufficient credits.** If `cs.spendCredit(userId)` throws `INSUFFICIENT_CREDITS`
  partway through a multi-tool turn (balance exhausted after N < 5 iterations), treat it the same as
  hitting the loop cap: stop consuming events, return the partial reply built so far, not a 500. The
  agent already did useful work; degrade gracefully rather than discarding it.
- **Removed:** the single pre-loop `spendCredit` call and its dedicated refund-on-precheck-failure
  path (lines 258-269). The first loop iteration's spend now serves as the balance gate — if the user
  has 0 credits, the very first `spendCredit` call throws `INSUFFICIENT_CREDITS` before any tool
  executes, functionally equivalent to today's pre-flight check but co-located with the metering
  logic instead of duplicated.
- **Refund scope on ADK error:** refund only the credits actually spent this turn (the accumulated
  txIds from however many loop iterations completed), not a fixed "1 credit" — this is what the
  Section C signature change (below) enables.

### `browser_action` interaction (verify, don't redesign)

`browser_action` tool calls happen inside this same ADK loop. Today, the text-path `browser_action`
handler skips its own `spendCredit` call (`preBilled: true` — see `docs/billing-and-credits.md:50`)
because the whole turn was already pre-paid with one flat credit before the loop ran. Under the new
per-loop billing, a `browser_action` invocation is just one more loop iteration and gets billed
naturally via the per-iteration `spendCredit`. The existing "skip, preBilled" logic in the
browser_action path should continue to skip its own separate spend — confirm this with a test
(`browserAction.test.ts`) so text-path browser_action isn't double-billed or silently unbilled after
this change. This is a verification item for the plan, not a design change — `browser_action`'s own
flat voice-path credit (1, contextual, unrelated timer) is out of scope for this spec entirely.

---

## C) Live Voice Websocket — `wsLiveAgentHandler.ts`

### `cloud-agent/src/services/creditService.ts` — signature change

Current `spendCredit(userId): Promise<string>` does a single-row atomic `UPDATE ... WHERE
remaining_balance >= 1` (lines 12-91) — it can only ever spend exactly 1 and cannot span rows. That
was an intentional simplification from PR #506 ("cannot fragment" because nothing spent more than
1). A 5-credit live-voice tick breaks that assumption: a user's balance can be fragmented across
multiple `credit_transactions` rows (e.g. 3 left in an expiring subscription grant + 2 in a signup
grant), and no single row may hold 5.

**Fix:** port the multi-row FIFO allocator already proven in
`functions/src/services/creditService.ts:127-` (net-balance check against the requested `amount`,
then loop-allocate across rows ordered `expires_at ASC NULLS LAST` until `amount` is exhausted, all
inside one DB transaction, same lock ordering — subscriptions row first, then credit_transactions)
into `cloud-agent/src/services/creditService.ts`.

New signature: `spendCredit(userId: string, amount = 1): Promise<string[]>` (array of debited
`credit_transactions` row ids, one or more). `refundCredit(userId: string, txIds: string[]):
Promise<void>` refunds the full set atomically in one transaction.

**Ripple — every existing caller** of `spendCredit`/`refundCredit` in cloud-agent changes from a
single `string` txId to a `string[]`. Full caller inventory (verified by grep, not assumed):
- `index.ts:261,287,299` (`POST /agent/run`, Section B) — `amount` always 1 per call now,
  single-element array; refund logic updated to pass/spread the array instead of one txId.
- `wsLiveAgentHandler.ts:339` — `cs.spendCredit(userId, 5)`, one atomic call/transaction per tick
  (not five sequential 1-credit calls — avoids N+1 query thrashing on a hot 60s-recurring path).
- `tools/browserAction.ts:96,112,131` — **the actual browser_action spend site** (not the ws
  browser handler). Uses `spendCredit(deps.userId)` (default `amount = 1`) and `refundCredit(userId,
  txId)` in two places; `txId: string | null` local becomes `string[] | null`. Signature-only
  update, but it **won't typecheck** if missed.
- `wsAgentHandler.ts:112,131,175` (+ `refundCredit` at 73) and `schedulerTriggerHandler.ts:187,216,263`
  (+ `Pick<CreditService,...>` type at 96) — signature-only update (still `amount = 1`).
- Test mocks in `index.test.ts`, `wsAgentHandler.test.ts`, `wsLiveAgentHandler.test.ts`,
  `schedulerTriggerHandler.test.ts`, `browserAction.test.ts` updated to return/accept arrays.

`wsBrowserAgentHandler.ts` has **no** `spendCredit` reference — it delegates billing to the
`browser_action` tool (`tools/browserAction.ts`). Not a caller; do not touch.

This duplicates FIFO-allocation SQL logic across two codebases (functions/ and cloud-agent/) rather
than sharing it — accepted tradeoff to keep the services decoupled and avoid an internal RPC hop on
every 60-second billing tick (network round-trip + new service-to-service auth surface would be
worse for a hot path than duplicated, well-tested SQL).

### Gate and timer

- Timer interval unchanged: `billingIntervalMs` defaults `60_000` (`wsLiveAgentHandler.ts:108`).
- Tick deduction: `cs.spendCredit(userId, 5)` (was `cs.spendCredit(userId)` → 1) at line 339.
- Server connect gate (`wsLiveAgentHandler.ts:316`): `balance < 2` → `balance < 5`.
- Client connect gate (`src/hooks/useLiveVoiceChat.ts:31`): `MIN_CREDITS_FOR_CALL = 2` → `5`.

### Talk UI — `LOW_CREDIT_THRESHOLD`

`app/(drawer)/(tabs)/talk/index.tsx`'s `LOW_CREDIT_THRESHOLD = 5` was sized as "~5 min runway at the
old 1 credit/60s rate." At the new 5 credits/60s rate, 5 credits now buys ~1 minute, not 5.
**Decision: leave `LOW_CREDIT_THRESHOLD = 5` unchanged.** The low-credit warning now fires with less
runway remaining than before — accepted, no scaling.

---

## D) Documentation — `docs/billing-and-credits.md`

Rewrite the Credit Consumption table (currently lines 28-38) with the new costs from the Overview
table above. Specific changes:
- Split the single `generateReply` row into two: grounded (3) and standard (1), keyed off
  presence/absence of caller-supplied `tools`.
- Add rows for `summarizeText` (1) and `generateEmbedding` (1 per 50k chars, `Math.ceil`) —
  currently absent because both are unbilled.
- Update Agent Turn row: `1 / turn (flat)` → `1 / internal loop, max 5`.
- Update Live Voice row: `1 / 60s timer` → `5 / 60s timer`.
- Update the connect-gate line (currently line 39): `≥ 2` → `≥ 5`.
- `browser_action` contextual billing section (lines 43-56) — **unchanged**, not part of the
  finalized table, out of scope.
- Wiki/DOCX/memory rows — unchanged (no-op row, still 1).

---

## E) Consumer-facing copy

Two spots reference the stale "1 credit per minute" live-voice figure and need updating to 5:

| File | Line | Current | New |
|---|---|---|---|
| `app/index.web.tsx` | 29 | "...1 credit per minute for live voice." | "...5 credits per minute for live voice." |
| `src/components/LandingPage/FeaturesSection.tsx` | 11 | "(Live voice sessions cost just 1 credit per minute.)" | "(Live voice sessions cost 5 credits per minute.)" — drop "just," no longer the cheap framing |

**Unchanged, explicitly out of scope:**
- `app/(drawer)/(tabs)/characters/[id]/edit.tsx:469` ("Costs 1 credit per sync") — wikiSync, no
  price change.
- `app/support.tsx:92` ("Voice replies cost 2 credits per reply") — references the dead
  `generateVoiceReply` one-shot path, already slated for full deletion by
  `2026-07-01-live-voice-credit-reconciliation-design.md` §3. Will disappear when that spec's
  deletion lands; not duplicated here.

---

## What does NOT change

- `browser_action` tool's own flat voice-path credit (1, separate contextual billing, paused during
  wake) — not part of the finalized pricing table.
- Scheduler trigger cost (1, deduped) — unchanged.
- `wikiSync` / `wikiLlm` / `memoryWrite` / `memoryHeal` — unchanged, still 1 each.
- `functions/src/services/creditService.ts` (Functions-side multi-row allocator) — already supports
  variable `amount`; not modified, only new call sites added.
- No rate-versioning, no grandfathering of in-flight sessions across the deploy boundary (hard
  cutover, see Overview).
- `generateEmbedding`'s `MAX_TEXT_LENGTH` (stays `8_000`) — the `Math.ceil` formula ships now but
  only becomes multi-credit-relevant if the cap is raised later.

---

## Testing

| Area | Test |
|---|---|
| Callables (A) | `summarizeText.test.ts`, `generateEmbedding.test.ts` — new spend/refund coverage (currently untested for billing since unbilled). `convertDocumentText.test.ts`, `generateImage.test.ts` — cost constant bump to 2. `generateReply.test.ts` — grounded (3) vs standard (1) branch, keyed off `tools` presence. |
| Agent loop (B) | `cloud-agent/src/index.test.ts` — per-iteration spend, hard stop at loop 5 with forced summary, refund-on-ADK-error refunds only credits actually spent (not a fixed 1), mid-loop `INSUFFICIENT_CREDITS` degrades to partial reply instead of 500. `browserAction.test.ts` — confirm text-path `browser_action` still skips its own spend (`preBilled`) and isn't double- or un-billed under per-loop billing. |
| Multi-row spend (C) | `cloud-agent/src/services/creditService.test.ts` — new: fragmented-balance 5-credit spend spans multiple rows atomically; insufficient net balance across all rows throws; refund of a multi-row txId array restores all rows. Existing single-credit callers updated to array-shaped return/refund calls: `index.test.ts`, `wsAgentHandler.test.ts`, `wsLiveAgentHandler.test.ts`, `schedulerTriggerHandler.test.ts`. |
| Gate (C) | `wsLiveAgentHandler.test.ts` — connect gate rejects at balance 4, allows at 5. `useLiveVoiceChat` test (client) — `MIN_CREDITS_FOR_CALL` gate at 5. |
| Docs (D) | Manual review — table matches Overview costs exactly, gate line says `≥ 5`. |
| Consumer copy (E) | Manual review — both files say "5 credits per minute," `edit.tsx` and dead-path `support.tsx` line untouched. |

### Verification commands

| Suite | Command | Expected |
|---|---|---|
| Functions | `cd functions && npm run typecheck && npm run lint && npm test` | pass |
| Cloud-agent | `cd cloud-agent && npm run typecheck && npm run lint && npm test` | pass |
| Root | `npm run typecheck && npm run lint && npm test` | pass |
