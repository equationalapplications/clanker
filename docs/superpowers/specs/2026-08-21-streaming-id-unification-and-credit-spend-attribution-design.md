# Streaming ID Unification & Credit Spend Attribution

**Date:** 2026-08-21
**Status:** Approved 2026-08-21 — implementation pending
**Owner:** equationalapplications
**Files affected:** `src/hooks/useAIChat.ts`, `src/components/ChatView.tsx`, `functions/src/services/creditService.ts`, `functions/src/db/schema.ts`, `functions/src/db/migrations/` (one hand-written file), `cloud-agent/src/services/creditService.ts`, and the spend call sites listed below
**Depends on:** [gifted-chat Removal](./2026-08-11-gifted-chat-removal-design.md) (our own `ChatView`/`MessageList` this builds on)

Two independent defects ship in **one PR as two separate commits**, each revertable at commit granularity.

## Problem

1. **Streaming flicker.** On every cloud-agent turn the streaming bubble unmounts and a second bubble mounts when the reply is persisted. `useAIChat.ts:125` mints the streaming row `_id` as `streaming_${Date.now()}`, then `useAIChat.ts:154` mints a _different_ id (`ai_${Date.now()}_…`) at persist time. Rows are keyed by `_id`, so the stream→persist transition swaps keys and React tears down/rebuilds the node — visible as a blink. There is also a blank-gap window: `onSettled` (`useAIChat.ts:372-376`) clears `streamingMessage` before the invalidation refetch delivers the persisted row.

2. **Credit spend has no attribution.** Both credit services mutate grant rows in place — `functions`' `spendCredits(userId, amount)` and cloud-agent's `spendCredit(userId, amount?)` decrement `credit_transactions.remaining_balance` FIFO under lock. No record of _what_ a purchase of credits was spent on exists anywhere, so issue #375 and any per-feature cost question are unanswerable.

### Scope history (why this spec is only two fixes)

This spec was originally scoped to four items. Investigation on 2026-08-21 resolved two:

- **RECITATION empty-retry** — already implemented in `2d42797f`; RECITATION sits outside `NON_RETRYABLE_EMPTY_RESPONSE_FINISH_REASONS` precisely because "a second draw often clears it" (`vertexText.ts:37-46`), covered by `vertexText.test.ts`.
- **Deeplink verification** — already resolved by `8bcd2714` (Play App Signing fingerprint added to `assetlinks.json`, deployed). Verified live 2026-08-21: apex serves the file 200 with both cert fingerprints; iOS AASA correct; `www.clanker-ai.com` redirects via Squarespace but is not a declared intent-filter host so it cannot affect verification. If a device still reports the domain unverified, force a re-check: `adb shell pm verify-app-links --re-verify com.equationalapplications.clanker`. Cert fingerprints in these files are public by design (the cert ships inside the APK).

## Goals

- One `_id` per AI reply from stream start through persistence; no remount, no blank gap.
- Every credit spend recorded with a machine-queryable reason, atomically with the spend.
- Compiler-enforced coverage: an untagged call site fails typecheck.

## Non-Goals

- No reporting UI or admin surface (issue #375 is answered by SQL over the new table).
- No refund attribution — `refundCredit` / `refundCredits` unchanged.
- No backfill of historical spends.
- Allocations detail (which grant rows funded a spend) is returned to callers but **not persisted**.
- No changes to balance math, lock order, or the subscriptions cache sync.

---

## Fix A — Streaming ID unification (app)

### Design

1. **Mint once, up front.** In `runCloudAgentTurn`, before `callCloudAgent`:
   ```ts
   const aiMsgId = `ai_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
   ```
   Use it for both `streamingMessage._id` (replacing `` `streaming_${Date.now()}` `` at line 125) and the `saveAIMessage` argument (line 154's expression moves here).
2. **Dedupe guard in `ChatView.tsx:155`:**
   ```ts
   const displayMessages = streamingMessage
     ? [streamingMessage, ...messages.filter((m) => String(m._id) !== String(streamingMessage._id))]
     : messages
   ```
   Order-independent: whichever of {streamed row, persisted row} arrives first wins; no duplicate keys.
3. **Clear only after delivery.**
   - Text path: `onSuccess` awaits `queryClient.invalidateQueries(...)` (resolves when the refetch completes), then clears `streamingMessage`, inside `try/finally` so a failed refetch can never orphan the bubble. Remove the clear from `onSettled` (keep `setIsSendingMessage(false)` / `setActiveTool(null)` there); add an immediate clear to `onError` — on failure there is no persisted row to hand off to.
   - Photo path: `sendPhoto`'s `finally` currently does `void invalidateQueries` then clears; make it await the invalidation, then clear, same `try/finally`.
4. Edge and Firebase-escalation paths never set `streamingMessage` today and stay untouched. The id format (`ai_…`) is unchanged, so SQLite rows are byte-compatible — no data migration.

### Why this shape

Same key start-to-finish means React reconciles the bubble in place; the dedupe guard makes clear-vs-refetch ordering irrelevant; awaiting the refetch closes the gap window. Rejected: key tricks or crossfades (mask the remount instead of removing it).

---

## Fix B — Credit spend attribution (both backends)

### Current architecture (verified)

One Postgres ledger, two writers, identical FIFO semantics and lock order:

| Service                                     | Signature                                              | Style                 | Call sites                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `functions/src/services/creditService.ts`   | `spendCredits(userId, amount)`                         | Drizzle query builder | memory ×2, document convert, character gen, wiki LLM, image gen, generateReply, embedding, summarize                                                          |
| `cloud-agent/src/services/creditService.ts` | `spendCredit(userId, amount = AGENT_TURN_CREDIT_COST)` | Raw SQL               | per-ADK-iteration chat (`agentEventLoop.ts:105`), browser action (`tools/browserAction.ts:101`), live voice (spend callbacks wired from `wsLiveAgentHandler`) |

Cloud-agent is the highest-volume writer (every cloud chat turn spends per iteration), so instrumenting only `functions` would miss most usage. **Both services gain attribution.**

### Schema

```sql
CREATE TABLE credit_spend_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount integer NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_spend_events_user_created_idx
  ON credit_spend_events (user_id, created_at DESC);
CREATE INDEX credit_spend_events_reason_idx ON credit_spend_events (reason);
```

Append-only side table: nothing that computes balances reads it, so existing queries are untouched. `reason` is free-form `text` — new features never need a migration. Migration is a **hand-written next-index SQL file** in `functions/src/db/migrations/` per repo convention (the drizzle journal is out of sync; never run `drizzle-kit generate`). Mirror the table in `functions/src/db/schema.ts` for typed inserts; cloud-agent inserts via raw SQL (it already touches `credit_transactions` without a local schema declaration).

### Service changes

Both signatures become `(userId, amount, reason: string)` with **all three required** — uniform across services, explicit costs everywhere (`agentEventLoop` passes `AGENT_TURN_CREDIT_COST` explicitly instead of relying on the default):

- `functions`: `spendCredits(userId: string, amount: number, reason: string)` — insert one event row inside the existing transaction after the allocation loop succeeds (before `syncSubscriptionCache`).
- `cloud-agent`: `spendCredit(userId: string, amount: number, reason: string)` — same insert inside its transaction after allocations succeed.

The event row is atomic with the spend: rollback on any later failure removes it; insufficient credits writes nothing.

### Reason vocabulary (registry — add new tokens here)

Fixed snake_case tokens; free-form column, documented registry:

| Token                | Call site                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `chat_reply`         | `generateReply.ts:514` (Firebase escalation path); `agentEventLoop.ts:105` (cloud agent iterations, photo turns included) |
| `browser_action`     | `browserAction.ts:101`                                                                                                    |
| `live_voice`         | live-voice spend callback wiring (plan pins exact site)                                                                   |
| `memory_action`      | `memoryFunctions.ts:1531`, `memoryFunctions.ts:1609`                                                                      |
| `document_convert`   | `convertDocumentText.ts:157`                                                                                              |
| `character_generate` | `characterFunctions.ts:438`                                                                                               |
| `wiki_llm`           | `wikiLlm.ts:137`                                                                                                          |
| `image_generate`     | `generateImage.ts:127`                                                                                                    |
| `embedding`          | `generateEmbedding.ts:190`                                                                                                |
| `summarize`          | `summarizeText.ts:132`                                                                                                    |

Plan-time sweep: confirm the live-voice `spend:` wiring site and grep both backends for any additional deduction entry point missed here.

### Answering #375

```sql
SELECT reason, SUM(amount) AS total_credits, COUNT(*) AS events
FROM credit_spend_events
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY reason ORDER BY total_credits DESC;
```

---

## Testing

**Fix A**

- Extend the MessageList streaming-key invariant test (`src/components/__tests__/MessageList.test.tsx`): stream→persist with the **same** `_id` renders one row whose key never changes (no remount).
- New ChatView test: persisted row arrives while `streamingMessage` is set → rendered exactly once.
- useAIChat tests: persisted id equals streamed id; success clears streaming only after invalidation resolves; failure clears immediately.
- Known baseline flakes (`useAIChat.test.tsx` "persists the user message…", avatarPicker under parallel load) are pre-existing — do not attribute regressions to them.

**Fix B**

- creditService unit tests (both services): successful spend inserts exactly one event row with correct `reason`/`amount`; insufficient credits inserts none; injected failure after the insert rolls it back.
- Typecheck enforces full call-site coverage (required param).
- Migration applied locally against docker Postgres; assert table + indexes exist.

## Rollout & rollback

- One PR → `staging`; commit 1 = Fix A (app), commit 2 = Fix B (schema + both backends + migration). CI gates run `:check` scripts only; no formatting sweeps mixed in.
- Fix A revert = revert one commit.
- Fix B migration is purely additive; reverting the code stops event writes and leaves an inert table. Dropping it later is a deliberate follow-up, never automatic.
- Functions/cloud-agent deploys go straight to production on merge (no staging environment) — additive-only keeps blast radius minimal. Check whether `cloud-agent/scripts/seedLocal.ts` needs the new table for fresh local DBs.

## Verification (manual)

- Web + device dev build, cloud-synced character: send a text turn and watch the streaming bubble persist without blinking; repeat with a photo turn.
- After deploy: send one chat turn, then confirm `SELECT * FROM credit_spend_events ORDER BY created_at DESC LIMIT 5;` shows a `chat_reply` row.
