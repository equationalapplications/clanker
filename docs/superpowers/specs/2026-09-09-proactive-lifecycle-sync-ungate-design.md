# Proactive Lifecycle-Sync + Push Un-gate Design

**Status:** Draft
**Date:** 2026-09-09
**Phase 2 spec:** `docs/superpowers/specs/2026-09-08-proactive-character-scheduler-phase2-design.md`
**Predecessors:** PR #707 (review-fix wave), PR #708 (clamp-reason telemetry)

---

## Problem

Phase 2 shipped the entire backend half of the proactive lifecycle — the sweeper
runs real turns, the handler persists proactive messages server-side with
`read_at`, `sendCharacterProactive` builds a correct push payload, and the
`fetchProactiveMessages` / `markProactiveRead` callables are deployed — and the
client half is **built but unwired**: `syncProactiveMessages` (transactional
cursor+apply loop), the durable mark-read retry queue, the two-phase local
write, and the unread hook all exist with tests and zero production callers.
`PROACTIVE_PUSH_ENABLED` is pinned `false` because a push today deeplinks into
an empty thread: nothing pulls proactive messages onto the device, nothing
renders a badge, and nothing routes a notification tap.

This fast-follow wires the system together and un-gates push, per the gate
comment's mandate that un-gating land in the same change that wires the sync
triggers.

## Goals

- A chosen `notify` actually notifies — and the tapped notification opens a
  populated chat.
- The unread dot on the character list reflects the same state the server
  guardrail reads, and clears optimistically when the chat is opened.
- No client that cannot handle a proactive push ever receives one — including
  clients that *used* to be able to and were replaced as the push-token target.

## Non-goals

- Tuning `DAILY_PROACTIVE_POWER_CEILING` / `PROACTIVE_NOTIFY_COOLDOWN_MS` /
  `MAX_PROACTIVE_PUSHES_PER_DAY` beyond what the pre-merge telemetry re-run
  justifies (see Rollout gate). Values ship unchanged unless the data says
  otherwise.
- Two-way message sync, web push, per-character mute controls (Phase 3).
- Changing the shadow-mode sweep, guardrail arithmetic, or delivery-mode
  recording (PR #708's clamp reasons).

## Locked decisions (carried from Phase 2, confirmed against shipped code)

1. **Badge** is a single boolean dot per character (`useProactiveUnread`
   already returns `hasUnread`), not a count.
2. **Push body** is a text preview truncated at 140 code points (shipped in
   `sendCharacterProactive`); lock-screen privacy is the OS's job.
3. **Cursor** persists in local SQLite `sync_state`, advanced in the same
   `withTransactionAsync` as the message inserts (shipped).
4. **7-day escape** is mirrored client-side: the badge filters on
   `read_at IS NULL AND created_at > now - UNREAD_STALENESS_ESCAPE_MS`
   (shipped in `countUnreadProactive`); the server never falsifies `read_at`.

---

## Decisions

### Decision 1 — A per-user capability flag gates the push, not the message

**Decision:** Migration `0030` adds
`users.proactive_push_ready boolean NOT NULL DEFAULT false` (both
`functions/src/db/schema.ts` and `cloud-agent/src/db/schema.ts`).
`registerExpoPushToken` accepts an optional
`capabilities.proactivePush: boolean` body field and writes the column
**explicitly in both directions**:

```
proactive_push_ready = capabilities?.proactivePush === true
```

The new client sends `true` at registration; old clients omit the field and
actively set the column `false`. The flag is only ever written alongside a
push token, and `users.expo_push_token` is single-token per user (last device
wins), so the flag always describes the device the token points at.

cloud-agent's `loadCharacter` additionally selects the flag, and the handler
calls `sendCharacterProactive` only when
`mode === 'notify' && character.proactivePushReady`.

**Reasoning:** the backend deploys instantly; store/OTA client rollout is
gradual. Flipping the global gate alone would fire pushes at clients that
cannot sync, badge, or deeplink — the notification-tap-into-nothing failure
the gate exists to prevent, displaced onto old clients. Worse, without the
bidirectional write, an old *replacement* device re-registering its token
would inherit the flag of the new device it replaced. The flag converts a
global, irreversible flip into a per-user, self-healing rollout: readiness
arrives exactly when a capable client registers, and a downgrade undoes it.

The flag gates **only the notification**. A quiet message persists and syncs
identically — that is the existing `quiet` semantic, and the message was the
point of the turn.

**Reversibility:** additive column with a default; dropping it is a new forward
migration per the no-DOWN runner. The flag can be force-cleared fleet-wide
with one `UPDATE users SET proactive_push_ready = false` if a push-content
incident requires it, without touching code.

### Decision 2 — Notification-tap routing, with cold-start and validation

**Decision:** a `useProactiveNotificationRouting` hook mounted in
`app/_layout.tsx`:

- `Notifications.addNotificationResponseReceivedListener`: on response whose
  `data.type === 'PROACTIVE_CHARACTER_MESSAGE'` and whose `data.deepLink`
  matches `/^\/chat\//`, fire the same in-flight-guarded sync trigger
  `useProactiveSync` exposes (non-blocking) and `router.push(deepLink)`.
- Cold start: `Notifications.getInitialNotificationAsync()` inside a
  post-mount effect, so the router exists before navigation.
- Anything else in the payload (or a non-matching type) is ignored — the hook
  routes, it does not interpret.

**Reasoning:** no notification-response handling exists anywhere in the app
today (the only listener is the browser-agent's category registration). Push
is a hint (Phase 2 Decision 5), so the sync fires non-blocking and navigation
never waits on the network — `ChatView`'s 5s poll plus the sync's cache
invalidation populate the thread as the data lands. The strict `type` +
prefix validation means a malformed or foreign payload cannot route the user
anywhere unexpected.

### Decision 3 — Sync on foreground, on tap, and on foreground receipt; invalidate on completion

**Decision:** a `useProactiveSync(uid)` hook mounted in `app/_layout.tsx`
fires `syncProactiveMessages(uid)` on app foreground (AppState listener) and
on foreground receipt of a `PROACTIVE_CHARACTER_MESSAGE` notification, with an
in-flight guard so overlapping triggers share one run. On completion it
invalidates the `proactiveUnreadKeys` and `messageKeys` React Query caches so
badges and threads refresh immediately instead of on the 5s poll.

**Reasoning:** the Phase 2 spec mandates fetch-on-receipt *and* fetch-on-
foreground regardless of push (Decision 5) — dropped pushes cost timeliness
only. The in-flight guard matters because foreground + tap + receipt can fire
within one tick; the sync's transactional cursor makes redundant runs *safe*,
but not free. Cache invalidation is what turns sync from a side effect into
UI: without it the badge waits out the poll interval.

### Decision 4 — Optimistic local mark-read on chat open, backed by the durable queue

**Decision:** on `ChatView` mount, if `countUnreadProactive(characterId) > 0`:

1. Write `read_at` locally for the character's unread proactive rows (new
   `messageDatabase` function, one `UPDATE ... WHERE read_at IS NULL`), then
   invalidate `proactiveUnreadKeys` — the dot clears the moment the chat is
   open, not after a server round-trip.
2. Enqueue the ids into the existing `proactiveReadQueue` and bind the real
   `httpsCallable('markProactiveRead')` as its `MarkReadCall`.
3. Flush the queue on app foreground and after each successful sync.

The local write marks **all** of the character's unread proactive rows, not
just the 7-day window the badge counts — reading the chat means reading the
thread, and the server guardrail's own staleness escape makes the distinction
invisible to the push decision.

**Reasoning:** only sync writes local `read_at` today, so without step 1 the
dot would stay lit while the user is literally reading the chat until the
server write round-tripped and re-synced. The queue (built, tested, unwired)
covers transient failure; the server's 7-day escape covers permanent loss —
Phase 2 Decision 7 unchanged. Server `message_id` is used verbatim as the
local `messages.id` (Phase 2 Decision 4), so the ids enqueued are the ids
the server expects.

### Decision 5 — Restore the badge

**Decision:** `CharacterCard` renders the unread dot from
`useProactiveUnread(characterId)`.

**Reasoning:** the dot was severed in `86de54b5` with a comment stating the
exact un-sever condition: a message must have something to deeplink into.
Decisions 2–4 are that condition. No design freedom remains — boolean dot,
character list only.

### Decision 6 — Un-gate

**Decision:** `PROACTIVE_PUSH_ENABLED = true` in
`cloud-agent/src/handlers/proactiveWakeupHandler.ts`; the TEMPORARY comment
is removed; the flip test now expects `notify` for a permitted notify. The
push gate and the capability flag compose: a chosen notify reaches a device
only when the guardrails allow it *and* the user's registered client is
capable.

**Reasoning:** the gate's own comment mandates un-gating in the same change
that wires the sync triggers. With Decision 1 in place, "same change" no
longer means "blast every client" — the flag carries the blast radius
per-user.

---

## Architecture

```
device (new client)                     functions                        cloud-agent
──────────────────                      ──────────                       ───────────
registerExpoPushToken ────────────────► users.expo_push_token =
  {token, capabilities:                  token, proactive_push_ready = true
   {proactivePush: true}}

…sweeper turn claims a wakeup; guardrails pass; handler runs the turn…

                                        ◄── POST /agent/proactive-wakeup ──
                                        persist message (read_at NULL)
                                        mode=notify && user flag ►
                                          sendCharacterProactive ─► push
foreground / tap / receipt
  └─ syncProactiveMessages(uid)
       fetchProactiveMessages ────────► cursor page (owned chars only)
       INSERT OR IGNORE + read_at backfill   (existing two-phase apply)
       cursor advanced, same tx
       invalidate unread + message caches
ChatView mount, unread > 0
  ├─ local read_at write + invalidate   (dot clears now)
  └─ enqueue → markProactiveRead ─────► read_at = now (NULL→ts only)
       (durable queue; flush on fg/sync)
```

### Components

**Server (functions)**

- Migration `0030_users_proactive_push_ready.sql` + both schema files.
- `registerExpoPushToken`: optional `capabilities.proactivePush`; explicit
  two-directional write (Decision 1).
- No change to `fetchProactiveMessages` / `markProactiveRead` — already
  deployed and correct.

**Server (cloud-agent)**

- `loadCharacter` select gains `proactivePushReady`; handler gates the send
  on it (Decision 1).
- `PROACTIVE_PUSH_ENABLED = true` (Decision 6).

**Client (root package)**

- `useProactiveNotificationRouting` (Decision 2), mounted in `app/_layout.tsx`.
- `useProactiveSync` (Decision 3), mounted in `app/_layout.tsx`.
- `messageDatabase`: `markProactiveReadLocally(characterId)` (Decision 4).
- `ChatView`: mark-read on mount (Decision 4); queue binding lives with the
  sync hook so both share one `httpsCallable` construction.
- `CharacterCard`: the dot (Decision 5).

## Ownership and authorization

No new auth surface: `registerExpoPushToken` already resolves the caller from
`request.auth.uid` (App Check enforced); the capability field rides the same
authenticated write and can only ever set the caller's own row.
`fetchProactiveMessages` / `markProactiveRead` are already ownership-scoped
server-side. The deeplink route is validated client-side against
`^\/chat\//` and expo-router resolves it to the user's own chat screen (auth
unchanged). Account deletion needs no new work: proactive rows already carry
the owner's `sender_user_id`.

## Rollout gate (workflow, blocking)

The Phase 2 spec's gate is explicit: before any build that can deliver a
user-visible push ships, re-run `functions/scripts/proactiveTelemetry.mjs`
against production and revisit the three constants against the observed
distribution. This branch runs it **before merge**, with the new CLAMP
REASONS query from PR #708 giving the first clean `gate` vs `guardrail`
split. The numbers land in the PR description; caps lock or change based on
them. No constants change silently.

Deploys go straight to production (`staging` is a merge target only): the
functions + cloud-agent deploys are behavior-neutral until capable clients
register (flag defaults `false`), and I verify the new revisions took traffic
per the 0%-traffic-anomaly playbook.

---

## Testing

Per-package conventions: `node:test` in `functions` and `cloud-agent`
(built output), Jest at the root (`npx jest <path>` to filter; root
react-query tests need `gcTime: 0`). Baselines to hold or beat: functions
522, cloud-agent 348 + 1 skip, root 158 suites / 1441 tests.

**What must be covered:**

- **Migration `0030`** — column exists with default `false`; additive.
- **`registerExpoPushToken` capability write** — `true` sets ready;
  omitted sets ready `false` (the downgrade path); `false` sets `false`;
  an unauthenticated/App-Check-less call still fails first; the token is
  written atomically with the flag.
- **cloud-agent gating** — `loadCharacter` surfaces the flag; the handler
  suppresses `sendCharacterProactive` for a `notify` on a flag-false user
  while still persisting the message as `mode=notify`; the flip test now
  expects `notify`; a guardrail-clamped notify stays `quiet` regardless of
  flag.
- **Deeplink routing** — tap with valid type + `/chat/…` link routes;
  cold start routes after mount; wrong `type`, malformed `deepLink`, and
  missing data are ignored, not crashed on.
- **Sync triggers** — foreground fires sync; foreground receipt fires sync;
  overlapping triggers share one in-flight run; completion invalidates the
  unread + message caches; sync failure does not invalidate (stale badge
  beats a lying one).
- **Local mark-read** — chat open with unread writes local `read_at` and
  clears the badge immediately; a second open is a no-op; enqueue + flush
  calls the server; a failed flush stays queued (retry survives restart,
  existing queue tests extended to the real binding).
- **Badge** — appears for an unread proactive message; clears on local
  write; ignores messages older than the 7-day escape (mirrored-constant
  tests already exist).
- **Telemetry gate** — not a test: the CLAMP RATE + CLAMP REASONS output
  recorded in the PR.

## Risks

**Old client, new flag=false registration after a capable session.** A user
alternating devices flips the flag per registration; pushes follow whichever
device last registered. That is the existing single-token semantic applied
consistently — the flag errs toward not pushing, which is the safe direction,
and sync still delivers the message on the next capable client's foreground.

**Cloud-agent deploys before the flag has any readers.** The handler change
and the schema addition ship together; a flag-`false`-for-everyone world is
today's world. No user-visible delta until a new client registers.

**Notification permission decline.** The message still syncs and badges on
foreground; only the interruption is lost. This is the Phase 2 push-as-hint
property doing its job.

**Local migration failure on device** (carried from Phase 2): the sync must
degrade to "no proactive messages" rather than throwing into the chat UI —
existing behavior, unchanged.

## Open questions

None. The four carried from Phase 2 are resolved by shipped code (Locked
decisions); the rollout-mechanism question is resolved by Decision 1.
