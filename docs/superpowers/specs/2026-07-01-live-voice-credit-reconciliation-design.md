# Live-Voice Credit Reconciliation & In-Call Indicator — Design Spec

**Date:** 2026-07-01
**Status:** Implemented
**Follows:** `2026-07-01-credit-improvements-design.md` (PR #506) — a post-ship review of that work found voice spends never reach the credit UI.

---

## Overview

The credit badge (`CreditCounterIcon`) and `CreditsDisplay` card read one source of truth:
`authMachine.context.subscription.currentCredits`. It updates two ways — full bootstrap refresh
(purchase/restore/manual/terms/foreground, foreground throttled to 5 min) and real-time
`USAGE_SNAPSHOT_RECEIVED` (dispatched right after a spend, timestamp-gated by
`applyUsageSnapshotIfNewer` so stale/out-of-order snapshots can't regress the count).

Text chat, image, and cloud-agent turns wire this correctly. **Live voice does not.**
`liveVoiceMachine` tracks its own `remainingCredits` and decrements it from per-minute
`USAGE_SNAPSHOT` socket events, but nothing bridges that to the auth machine. Consequences:

- **During a call:** the header badge (mounted in the drawer header, visible on the Talk screen)
  shows the pre-call number for the whole call. A user can burn many credits over a multi-minute
  call and see no movement.
- **After a call:** badge and `CreditsDisplay` stay stale until a manual "Sync" or a foreground
  refresh. Foreground is gated to 5 min (`FOREGROUND_STALE_MS`) and the call already ends on
  blur/background, so returning to the app usually isn't "stale enough" to refresh — the user
  finishes a call and still sees the old balance.

This spec fixes that reconciliation, adds an in-call credit indicator, and deletes the dead
one-shot voice reply path.

**Scope:** client only (`src/hooks`, `src/machines`, `app/(drawer)/(tabs)/talk`), plus deletion of
the dead `generateVoiceReply` chain (client services, Firebase callable, tests) and one
documentation row. No change to the live-voice billing backend or the `≥ 2` connect gate.

---

## Product Decisions (locked in)

| # | Topic | Decision |
|---|---|---|
| 1 | Reconcile trigger | Dispatch on **every** live `remainingCredits` change (not just teardown) so the badge ticks down live. |
| 2 | In-call indicator | **Persistent** credit count while a call is live/connecting, emphasized under a low threshold. |
| 3 | Low-credit threshold | `≤ 5` credits → emphasized (warn) styling. ≈ 5 min runway at 1 credit / 60s. |
| 4 | Dead voice path | **Full-chain delete** — `sendVoiceMessage`, client `generateVoiceReply`, `generateVoiceReplyFn` config exports, the Firebase `generateVoiceReply` onCall, and all their tests. |

---

## 1. Live-Voice → Auth Reconciliation (core)

### Mechanism

`useLiveVoiceChat` already holds `authService` (`src/hooks/useLiveVoiceChat.ts:35`) and exposes the
machine's live credit count via `state.context.remainingCredits`. Add a `useEffect` that dispatches
to `authService` whenever that value changes from a live socket tick:

```typescript
authService.send({
  type: 'USAGE_SNAPSHOT_RECEIVED',
  source: 'liveVoice',
  remainingCredits: state.context.remainingCredits,
  planTier: null,
  planStatus: null,
  verifiedAt: new Date().toISOString(),
})
```

- **Client-synthesized `verifiedAt`.** The live `USAGE_SNAPSHOT` socket event carries only
  `remainingCredits` — no server timestamp (`src/machines/liveVoiceMachine.ts:92`). We synthesize a
  client ISO timestamp, exactly as the cloud-agent path already does (`src/hooks/useAIChat.ts:258`).
  Successive dispatches within a session are monotonically increasing, so they pass the
  `applyUsageSnapshotIfNewer` gate (`incomingTs > currentTs`; value may decrease, floored at 0).
- **Skip the seed dispatch.** The machine's `initialCredits` seed equals the pre-call auth balance
  already in `subscription.currentCredits`. Guard with a ref that stores the **previous**
  `remainingCredits` value (not a "has mounted" boolean) and dispatch only when `prev !== current`.
  This skips the initial seed and is bulletproof against React's double-firing of `useEffect`
  (StrictMode), since a repeated run with an unchanged value is a no-op. Seed the ref with the
  initial `remainingCredits` so the first real socket tick is the first dispatch.
- **Teardown is covered automatically.** The last socket tick before `END_CALL` was already
  dispatched. The exhaustion path sets `remainingCredits: 0` (`liveVoiceMachine.ts:285`) before
  transitioning to `saving_to_db`, so the zero is dispatched too. No separate teardown hook needed.

### Type change

`AuthMachineEvents.USAGE_SNAPSHOT_RECEIVED.source` is currently
`'generateReply' | 'generateImage' | 'cloudAgent'` (`src/machines/authMachine.ts:70`). Extend the
union to include `'liveVoice'`.

### Accepted edge

If a prior snapshot in the same session ever carried a **server** `verifiedAt` ahead of the device
clock, a subsequent client-time live tick could be gated out (silently dropped). Single-screen usage
(a user is either in a live call or elsewhere, not both) makes cross-source timestamp contention
unlikely. Documented as accepted, not engineered around — consistent with the existing cloud-agent
client-time approach.

### Files

| File | Change |
|---|---|
| `src/machines/authMachine.ts` | Add `'liveVoice'` to `USAGE_SNAPSHOT_RECEIVED.source` union |
| `src/hooks/useLiveVoiceChat.ts` | Add reconcile `useEffect` on `state.context.remainingCredits` with change-only ref guard |

---

## 2. In-Call Credit Indicator (Talk UI)

`useLiveVoiceChat` already returns `remainingCredits`; `app/(drawer)/(tabs)/talk/index.tsx` never
renders it. Add a persistent count shown while the call is live or connecting.

- Destructure `remainingCredits` from `useLiveVoiceChat` (currently omitted at
  `talk/index.tsx:85-97`).
- Render a small text element (e.g. near the status text / `statusWrap`) while `isLive ||
  isConnecting`, hidden otherwise.
- Apply emphasized (warn-color) style when `remainingCredits <= LOW_CREDIT_THRESHOLD` (`5`).
- Define `LOW_CREDIT_THRESHOLD = 5` as a module constant alongside the existing UI constants.
- Label as credits (matches the header badge), not minutes — avoids a per-minute framing assumption.

Redundancy note: once §1 lands, the header badge also ticks down live. The in-call count is
justified by prominence on the Talk screen and the proactive low-balance emphasis the badge lacks.

### Files

| File | Change |
|---|---|
| `app/(drawer)/(tabs)/talk/index.tsx` | Destructure `remainingCredits`; render persistent count while live/connecting; `LOW_CREDIT_THRESHOLD` + warn style |

---

## 3. Delete Dead One-Shot Voice Reply Path

`generateVoiceReply` (cost 2) has **no runtime caller** — only tests reference the chain. The Talk
tab moved to live voice. `sendVoiceMessage` is called only from
`__tests__/voiceChatService.test.ts`; the client `generateVoiceReply` and `generateVoiceReplyFn` are
reachable only through `sendVoiceMessage`. The entire client → Firebase chain is dead from the app's
perspective.

Precedent: PR #506 Task 2 removed the dead `spendCredits` onCall the same way.

### Deletions (verify zero non-test references before removing each symbol)

| Action | Path |
|---|---|
| Delete | `src/services/voiceChatService.ts` (`sendVoiceMessage` + usageSnapshot block) |
| Delete | `src/services/voiceReplyService.ts` (client `generateVoiceReply`) |
| Delete | `__tests__/voiceChatService.test.ts` |
| Delete | `__tests__/voiceReplyService.test.ts` |
| Delete | `__tests__/firebaseConfigWebVoiceCallable.test.ts` |
| Delete | `functions/src/generateVoiceReply.ts` (onCall + handler) |
| Delete | `functions/src/generateVoiceReply.test.ts` |
| Modify | `functions/src/index.ts` — remove `generateVoiceReply` export |
| Modify | `src/config/firebaseConfig.ts` — remove `generateVoiceReplyFn` const + export |
| Modify | `src/config/firebaseConfig.web.ts` — remove `generateVoiceReplyFn` const + export |

### Deployment note

Removing `functions/src/generateVoiceReply.ts` from `functions/src/index.ts` **undeploys** the
`generateVoiceReply` cloud callable on the next Functions deploy. This is outward-facing but the
callable has no client caller, matching the #506 dead-callable removal.

### Documentation

Remove the `| One-shot voice reply | generateVoiceReply | 2 | Yes |` row from the Credit Consumption
table in `docs/billing-and-credits.md` (line 27). The **Live voice** row (line 31) and the `≥ 2`
connect-gate note (line 35) are independent of the one-shot path and stay unchanged.

---

## Testing

| Area | Test |
|---|---|
| Reconcile (§1) | `useLiveVoiceChat` test: a live `remainingCredits` change dispatches `USAGE_SNAPSHOT_RECEIVED` to `authService` with `source: 'liveVoice'`, matching credits, and an ISO `verifiedAt`. |
| Reconcile — no seed | Initial mount (seed value) does **not** dispatch; only socket-driven changes do. |
| Reconcile — exhaustion | Exhaustion tick (`remainingCredits: 0`) dispatches `0` before teardown. |
| Gate | authMachine already covers `applyUsageSnapshotIfNewer`; add a monotonic-decrement case if not present. |
| Indicator (§2) | Talk UI: count renders while live/connecting, hidden when idle, emphasized when `≤ 5`. |
| Deletion (§3) | Grep proves zero non-test references to each deleted symbol; Functions + root suites green after removal. |

### Verification commands

| Suite | Command | Expected |
|---|---|---|
| Root | `npm run typecheck && npm run lint && npm test` | pass |
| Functions | `cd functions && npm run typecheck && npm run lint && npm test` | pass (fewer tests after `generateVoiceReply.test.ts` removal) |

**Regression checks:**

- Start a live call → header badge ticks down as minutes are billed; after `END_CALL` the badge and
  `CreditsDisplay` show the post-call balance with no manual Sync.
- `sendVoiceMessage` / `generateVoiceReplyFn` / `generateVoiceReplyHandler` — no references anywhere
  in `functions/src`, `src`, `app`.
- Live-voice `≥ 2` connect gate unchanged (client `MIN_CREDITS_FOR_CALL` and server both still `2`).
