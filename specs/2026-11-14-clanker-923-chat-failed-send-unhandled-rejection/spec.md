# Spec: clanker #923 — failed chat send must not surface an unhandled rejection

**Date:** 2026-11-14 · **Status:** Approved by Kurt (2026-11-14, Discord msg 1571302973873594419) · **Issue:** #923 ·
**Repo:** clanker · **Base:** `origin/staging` (`b22fe336`) · **Lane branch:**
`fix/chat-failed-send-rejection`

## Goal

A failed chat send is reported exactly once — through the mutation's `onError`
(`setError`, bubble teardown, usage snapshot) — and never a second time as an
unhandled promise rejection (dev LogBox error / prod Crashlytics non-fatal).

## Cause (verified against `origin/staging` @ `b22fe336`)

- `src/hooks/useAIChat.ts:524-537` — `sendMessage` does
  `try { await aiMessageMutation.mutateAsync(message) } finally { turnInFlightRef.current = false }`
  with **no `catch`**. React Query's `mutateAsync` re-throws after `onError` runs, so the
  already-handled error propagates out of `sendMessage`.
- `src/components/ChatView.tsx:264` — `handleSend` does `await sendMessage(outgoingMessage)`
  with no `catch`, so the rejection reaches the global unhandled-rejection handler.
  Repro: `CLOUD_AGENT_INSUFFICIENT_CREDITS` on a 0-credit account (issue log).

## `sendPhoto` audited — no change needed

`sendPhoto` (`useAIChat.ts:539-628`) owns a `try/catch` that calls `reportError` +
`setError` and returns `false`. `ChatView.handleSendPhoto` (`ChatView.tsx:269-278`) awaits
it and propagates the boolean. The rejection never escapes. The issue's "check sendPhoto
too" item is satisfied by audit; the other `sendMessage(` grep hits
(`messageDatabase.ts`, `postNewMessage.ts`, `liveVoiceMachine.ts`, `useMessages.ts`) are
unrelated DB-layer functions, and the hook's `sendMessage` has exactly one caller
(`ChatView.handleSend`).

## Fix

One change, in `sendMessage` (`src/hooks/useAIChat.ts`):

```ts
try {
  await aiMessageMutation.mutateAsync(message)
} catch {
  // `onError` owns failure reporting (bubble teardown, setError, usage
  // snapshot, cache refetch). Swallow the re-thrown error here so the
  // failure is reported once — not again via the global unhandled-
  // rejection handler. Same no-throw contract as `sendPhoto`.
} finally {
  turnInFlightRef.current = false
}
```

Rationale for the location (vs catching in `ChatView.handleSend`): the hook already owns
all failure reporting via `onError`; swallowing at the hook boundary gives `sendMessage`
the same no-throw contract `sendPhoto` already has, so any future caller is safe by
construction. `sendMessage` returns `void`; no caller consumes a failure signal today.
`turnInFlightRef` is still reset in `finally`, so the mutex semantics are unchanged.

## Tests (TDD — RED before the fix)

In `src/hooks/__tests__/useAIChat.test.tsx`:

1. **`sendMessage` resolves when the mutation fails.** Mock the mutation to reject with
   `CLOUD_AGENT_INSUFFICIENT_CREDITS`; `await expect(sendMessage(msg)).resolves.toBeUndefined()`
   — on base this rejects (RED).
2. **Failure is still reported once through `onError`.** After the same failing call,
   the hook's `error` state is `CLOUD_AGENT_INSUFFICIENT_CREDITS` (regression guard
   against swallowing the reporting itself).
3. **Success path unchanged.** A resolving mutation still clears `error`.

In `src/components/__tests__/ChatView.test.tsx`:

4. ~~**`handleSend` does not reject when the send fails** — `handleSend` resolves
   (no throw through the component boundary) with the mocked hook send failing.~~
   **Dropped during implementation (documented in the LEDGER):** ChatView tests mock
   `useAIChat` entirely, so a rejecting mock would still reject through `handleSend`
   even with the real fix in place — the test would drive a redundant `catch` in
   ChatView rather than verify the fix. The no-throw contract is owned and tested at
   the hook boundary (test 1); `handleSend` stays catch-free by design.

No production code other than the one `catch` clause changes.

## Non-goals

- No change to `onError` behaviour, retry semantics, or the `turnInFlightRef` mutex.
- No retry queue / durable re-send for failed turns (tracked on the vision path spec).
- No change to `sendPhoto` (audited safe above).

## Gates

Local: typecheck, `lint:check`, targeted suites, full `test` suite,
`format:check` (prettier the spec before committing — CI covers `specs/*.md`).
PR: `run-staging-tests`, CodeQL, `check-merge-source` (lane → `staging`).
