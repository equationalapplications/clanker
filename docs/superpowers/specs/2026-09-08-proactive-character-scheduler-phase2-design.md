# Proactive Character Scheduler — Phase 2 Design

**Status:** Implemented
**Date:** 2026-09-08
**Phase 1 spec:** `docs/superpowers/specs/2026-09-08-proactive-character-scheduler-design.md`
**Phase 1 plan:** `docs/superpowers/plans/2026-09-08-proactive-character-scheduler-phase1.md`

---

## Problem

Phase 1 shipped the proactive scheduler in shadow mode. A character can schedule
a wake-up, the sweeper claims it, the cloud-agent runs a real agent turn against
real credits, and the guardrails decide what the character _would_ have done —
and then the result is written to `scheduled_wakeups.outcome` as a string and
thrown away. Nothing reaches the user.

Phase 2 makes the decision real: the character's proactive message is persisted,
synced to the device, badged on the character list, and — subject to the
guardrails — announced with a push notification.

The reason this is non-trivial rather than "write a row and render it" is a
storage asymmetry inherited from the cloud-agent migration. Chat history for the
cloud-agent path lives in **local SQLite on the device**
(`src/database/messageDatabase.ts`, read through `src/hooks/useMessages.ts`).
The server `messages` table is written **only** by the legacy `generateReply`
path (`functions/src/generateReply.ts:608`), and no callable pulls messages
down — `getUserCharacters` and `syncCharacterImages` sync down, messages never
do. A proactive message is the first message in this system that originates on
the server and must travel _to_ the device. Phase 2 therefore has to build a
server→device message sync path that does not exist today.

## Goals

- Persist proactive messages server-side and deliver them to every device the
  user owns.
- Show an unread badge on the character list, derived from the same state the
  push guardrail reads.
- Fire a push notification when — and only when — the Phase 1 guardrails allow
  it, deeplinking to the character's chat.
- Replace the `outcome LIKE 'mode=notify%'` string match with a real column
  before that count gates a user-visible push.
- Keep the failure modes bounded: no failure path may silently mute a character
  forever.

## Non-goals

- Tuning the cap and cooldown values. See **Assumptions** — this ships with the
  Phase 1 values behind a rollout gate.
- Migrating the legacy `generateReply` path or unifying it with the cloud-agent
  path.
- Two-way message sync. Phase 2 syncs server→device for proactive messages only;
  user messages continue to live on device.
- Web push. The web client has no push capability; it picks proactive messages up
  on next open, by design (see Decision 5).
- Per-character user controls for muting or frequency. Phase 3.

## Assumptions

**The guardrail constants are untuned and this spec does not tune them.**

```
DAILY_PROACTIVE_POWER_CEILING = 500
PROACTIVE_NOTIFY_COOLDOWN_MS  = 43_200_000   (12h)
MAX_PROACTIVE_PUSHES_PER_DAY  = 2
```

These were chosen blind before Phase 1 shipped. Phase 1 exists specifically to
produce the `mode=` distribution they should be tuned against, and at the time of
writing it had been live roughly four hours with `scheduled_wakeups` empty. The
attempt to query production telemetry for this spec was blocked by tooling and
no observed data was available.

Phase 2 carries these values forward **unchanged and explicitly untuned**, and
adds a hard gate:

> **Rollout gate.** Before any build that can deliver a user-visible push is
> released, re-run the Phase 1 telemetry queries (recorded in the Phase 1
> handoff) and revisit these three constants against the observed `mode=`
> distribution and skip-reason breakdown. Shipping the mechanism is not
> permission to ship the numbers.

**There is no deployed `staging` environment.** The `staging` branch is a merge
target only; deploys go straight to production. Every migration in this spec is
applied directly to `clanker-prod`, which is why Decision 2 requires the backfill
to be independently reversible.

---

## Decisions

### Decision 1 — Read state is a server-side `read_at` column

**Decision:** Add a nullable `read_at timestamptz` to the `messages` table
(migration `0029`) plus a `markProactiveRead` callable the client fires when the
user opens a chat containing unread proactive messages.

**Reasoning:** This is forced, not chosen. `proactiveWakeupGuardrails.ts:71`
gates pushes on `unreadProactiveCount === 0` — a "don't nag someone who hasn't
read the last one" rule. That is a **server-side** guardrail input, evaluated by
the sweeper with no device in the loop, so read state must be visible to the
server. Client-only read state is architecturally excluded; it could render a
badge but could never feed the guardrail.

Among the server-visible options, a per-message `read_at` beats a per-character
`last_read_at` because the badge and the guardrail both want a _count_ of unread
proactive messages, and it beats a marker inside the existing `message_data`
jsonb because counting would then require an unindexed jsonb predicate scan —
the same class of defect (querying a free-text field) that Decision 2 exists to
remove.

`unreadProactiveCount`, currently hardcoded to `0` at
`proactiveWakeupSweep.ts:212`, becomes a real indexed `COUNT`.

### Decision 2 — Promote the delivery mode to **two** columns, with a backfill, first

**Decision:** Migration `0028` adds **two** columns to `scheduled_wakeups` —
`delivery_mode` and `chosen_delivery_mode` — backfills existing rows by parsing
their `outcome` strings, and `todaysPushCount` switches to a real column
predicate on `delivery_mode`. This lands **before** anything gates a real push.

**Why two columns and not one.** `proactiveWakeupHandler.ts:203` writes
`outcome = 'mode=<effective> chosen=<model choice>'`, and those are two distinct
facts. `resolveDeliveryMode` (`proactiveWakeupHandler.ts:62-65`) clamps a chosen
`notify` down to `quiet` whenever `notifyAllowed` is false, so:

- `mode` — what was **effectively** delivered, after the guardrail clamp. This is
  what `todaysPushCount` must count, matching today's `LIKE 'mode=notify%'`
  prefix semantics.
- `chosen` — what the model **wanted** to do, before any clamp. The handler's own
  comment states why it is recorded: _"production data on how often characters
  WOULD have interrupted, before any user can be interrupted."_

`chosen` is the Phase 1 deliverable. It is the distribution the rollout gate
tunes the caps against, and collapsing both into one column would discard it
permanently — the exact data this feature's shadow-mode phase existed to collect.

**Reasoning:** `todaysPushCount` is currently derived by matching
`outcome LIKE 'mode=notify%'` against a free-text column
(`proactiveWakeupSweep.ts:195`). In Phase 1 that count gates nothing visible, so
a miss is harmless. In Phase 2 it gates real push notifications, where a miss
means either over-notifying a user past the daily cap or silently suppressing a
message. A string match on a human-readable outcome field is not an acceptable
basis for that.

The backfill is included rather than skipped because Phase 1's rows _are_ the
observational data the rollout gate depends on; leaving them `NULL` would make
the very distribution this feature was built to collect harder to query.

`0028` stays separate from `0029` despite both being small. They are independent
changes, and since they apply straight to production (see Assumptions), coupling
them would make a partial rollback impossible.

**Backfill shape.** Additive columns, then guarded `UPDATE`s that parse the
Phase 1 string. Every `UPDATE` carries an `IS NULL` guard so the whole migration
is safely re-runnable — a re-run after Phase 2 rows exist can never overwrite a
correctly written value with one re-parsed from free text:

```sql
ALTER TABLE scheduled_wakeups ADD COLUMN delivery_mode text;
ALTER TABLE scheduled_wakeups ADD COLUMN chosen_delivery_mode text;

-- Effective mode, after the notifyAllowed clamp. This is what todaysPushCount
-- counts. Prefix match, mirroring the LIKE 'mode=notify%' it replaces.
UPDATE scheduled_wakeups SET delivery_mode = 'notify'
  WHERE delivery_mode IS NULL AND outcome LIKE 'mode=notify %';
UPDATE scheduled_wakeups SET delivery_mode = 'quiet'
  WHERE delivery_mode IS NULL AND outcome LIKE 'mode=quiet %';
UPDATE scheduled_wakeups SET delivery_mode = 'silent'
  WHERE delivery_mode IS NULL AND outcome LIKE 'mode=silent %';

-- What the model chose before the clamp — the Phase 1 observational signal.
UPDATE scheduled_wakeups SET chosen_delivery_mode = 'notify'
  WHERE chosen_delivery_mode IS NULL AND outcome LIKE '% chosen=notify';
UPDATE scheduled_wakeups SET chosen_delivery_mode = 'quiet'
  WHERE chosen_delivery_mode IS NULL AND outcome LIKE '% chosen=quiet';
UPDATE scheduled_wakeups SET chosen_delivery_mode = 'silent'
  WHERE chosen_delivery_mode IS NULL AND outcome LIKE '% chosen=silent';
```

Rows whose `outcome` is not a `mode=` string at all — `stale_claim`,
`turn_failed`, `insufficient_power`, `identifier_mismatch`, `spend_failed`,
`character_missing`, and every skip reason — correctly keep `NULL` in both
columns. Both stay bare nullable `text`; no `CHECK` constraint, so a future mode
value cannot fail a write in production.

Both `functions/src/db/schema.ts` and `cloud-agent/src/db/schema.ts` declare
`scheduledWakeups` and both need the two new fields.

**Reversibility, precisely.** The columns are additive and nullable, and the
backfill derives entirely from `outcome`, which is left intact — so the columns
can be dropped and recomputed with no data loss.

But note what "reversible" means here mechanically: **the migration runner has no
`DOWN` support.** `functions/scripts/migrate.mjs` splits a comma-separated
`MIGRATIONS` list and executes those files forward; it never parses a `-- DOWN`
section. A `-- DOWN` comment in the file is documentation only. Rolling back
means writing and applying a _new forward migration_ that drops the columns.
This must not be discovered mid-incident.

### Decision 3 — Account-wide cursor sync, not per-character

**Decision:** One new callable, `fetchProactiveMessages({ sinceCreatedAt,
sinceMessageId, limit })`, returns proactive messages across all of the calling
user's characters, ordered and paginated by a `(created_at, message_id)` cursor.

**Reasoning:** The unread badge is a property of the character _list_, not of any
one chat. Mirroring the per-character shape of `syncCharacterImages` would mean
firing N parallel requests on every app foreground just to render badges
accurately, or building a second count endpoint beside the fetch. A single
account-wide call refreshes every thread and every badge at once.

Folding this into `getUserCharacters` was rejected: it would couple message sync
to character sync on a hot path, so a message-query failure would degrade the
user's ability to see their character list at all.

**Cursor shape:** `(created_at, message_id)`, both server-issued, compared
server-side as
`WHERE created_at > $1 OR (created_at = $1 AND message_id > $2)`. The device
never supplies its own clock, so device clock skew cannot corrupt the stream. The
`message_id` tiebreak matters concretely here: the sweeper processes a batch of
up to `SWEEP_BATCH_LIMIT = 50` wake-ups together, so rows sharing a `created_at`
to the millisecond are expected, not hypothetical, and a bare timestamp cursor
would skip or repeat them at a page boundary.

An opaque token was rejected as the wrong trade for a first-party client: it buys
schema-hiding that a private API does not need, at the cost of debuggability from
the device.

### Decision 4 — Two-phase local write: `INSERT OR IGNORE` then a narrow `read_at` update

**Decision:** The sync applies each page to local SQLite in two steps:

1. `INSERT OR IGNORE` for rows the device does not have — never overwrites local
   `text`, `message_data`, `pending`, `sent`, `error`, or `edited`.
2. `UPDATE messages SET read_at = ? WHERE id = ? AND read_at IS NULL` for rows it
   already has.

The server's `message_id` is used verbatim as the local `messages.id`, which is
`TEXT PRIMARY KEY`, so insert-level dedupe is structural rather than something
the sync has to reason about.

**Reasoning:** `INSERT OR IGNORE` alone is not sufficient, and this is the
non-obvious part. Read state is server-authoritative (Decision 1), but if the
user reads a message on their phone and then opens their tablet, the tablet
already holds that row, `IGNORE` skips it, and the badge never clears there. The
targeted `read_at` update is what lets server-authoritative read state converge
across devices while `IGNORE` still guarantees the sync can never clobber local
state.

The update is deliberately one-directional — `AND read_at IS NULL` means it only
ever moves NULL→timestamp, never back — so an out-of-order page cannot resurrect
a cleared badge.

Reusing the existing `batchInsertMessages` was rejected: it is `INSERT OR
REPLACE`, which would silently reset `pending`/`sent`/`error` on re-sync.

This requires a local SQLite migration (next index after `24`) adding
`read_at INTEGER` to the local `messages` table, following the established
numbered-migration pattern in `src/database/schema.ts`.

### Decision 5 — Push is a hint to sync, never the carrier

**Decision:** The push notification carries only enough to route the user
(character id, message id, a body preview). The message itself is delivered by
`fetchProactiveMessages`. The client fetches on receipt and on foreground
regardless of whether a push arrived.

**Reasoning:** Push delivery is best-effort on both platforms. If the push were
the carrier, a dropped notification would lose the message permanently. As a
hint, a dropped push costs _timeliness_ only — the message still arrives on next
sync. It also means the web client, which has no push at all, works correctly
with no separate code path.

### Decision 6 — A character-specific push method, not `sendProactive`

**Decision:** Add `sendCharacterProactive(expoPushToken, characterId, messageId,
characterName, body)` to `cloud-agent/src/services/fcmDispatcher.ts` alongside
the existing `sendProactive`.

**Reasoning:** The existing `sendProactive`
(`cloud-agent/src/services/fcmDispatcher.ts:87`) is not reusable here despite
being production-tested. It hardcodes the title `'Clanker noticed something'`,
`data.type: 'PROACTIVE_TASK'`, `deepLink: '/talk'`, and
`categoryIdentifier: 'BROWSER_ACTION_APPROVAL'` — all of which belong to the
browser-agent feature. A character wake-up needs the character's name as the
title, a deeplink to that character's chat rather than `/talk`, and no approval
category. Reusing it verbatim would send users a mislabelled notification into
the wrong screen carrying an action-approval affordance for an action that does
not exist.

The two methods share `expoPush` and the existing token plumbing
(`users.expo_push_token`, `registerExpoPushToken`); only the payload differs.

### Decision 7 — Mark-read gets both a client retry and a server staleness escape

**Decision:**

- The client queues and retries `markProactiveRead` on failure.
- The server's `unreadProactiveCount` ignores proactive messages older than
  `UNREAD_STALENESS_ESCAPE_MS = 7 days`.

**Reasoning:** The failure mode being defended against is silent and unbounded.
Because the guardrail requires `unreadProactiveCount === 0`, a single dropped
mark-read leaves the server believing the user is ignoring that character and
suppresses **all** future pushes from it — permanently, with no error surfaced
anywhere and no user-visible symptom other than the feature quietly ceasing to
work.

The retry handles the common case (transient loss of connectivity) and costs
little, since the unsynced-message machinery to build on already exists
(`getUnsyncedMessages` / `markMessagesAsSynced`). The staleness escape handles
permanent client loss — an uninstall while offline, a lost device, a wiped
profile — where no amount of retrying will ever succeed. Given that the entire
purpose of this feature is re-engagement, an unbounded silent mute is the worst
available outcome, and neither mechanism alone closes it.

---

## Architecture

### Data flow

```
sweeper (functions)                    cloud-agent                     device
──────────────────                     ───────────                     ──────
selectDue (pending)
  ├─ loadContext
  │    ├─ todaysProactiveSpend
  │    ├─ todaysPushCount   ← delivery_mode column   [0028]
  │    └─ unreadProactiveCount ← COUNT(read_at IS NULL)
  │                              excluding > 7d       [0029]
  ├─ evaluate guardrails → { run, notifyAllowed }
  ├─ claim ('claimed')
  └─ POST /agent/proactive-wakeup ─────►
                                        claim → 'running'
                                        run agent turn
                                        ├─ INSERT messages row
                                        │    message_id (server-minted)
                                        │    read_at = NULL
                                        └─ if notifyAllowed:
                                             sendCharacterProactive ──► push
                                                                        │ (hint)
                                        resolve wakeup                  ▼
                                        (status, delivery_mode)   fetchProactiveMessages
                                                                  (cursor)
                                                                        │
                                                                  INSERT OR IGNORE
                                                                  + read_at UPDATE
                                                                        │
                                                                  badge on list
                                                                        │
                                                                  user opens chat
                                                                        │
                                                                  markProactiveRead
                                                                  (retried)
                                              ◄─────────────────────────┘
                                              read_at = now()
```

### Components

**`functions` — sweeper and callables**

- `proactiveWakeupSweep.ts` — `loadContext` gains a real `unreadProactiveCount`
  query and switches `todaysPushCount` off the `LIKE` match.
- `fetchProactiveMessages` — new callable. Auth + App Check, cursor-paginated,
  scoped to the caller's own characters. Follows the `syncCharacterImages`
  shape: `onCall` wrapper plus an exported handler taking injectable deps so it
  is testable under `node:test`.
- `markProactiveRead` — new callable. Takes message ids, sets `read_at` where
  currently NULL and where the message belongs to the caller. Idempotent.

**`cloud-agent` — the turn and the push**

- The proactive-wakeup handler writes the `messages` row as part of resolving the
  wake-up, and calls `sendCharacterProactive` when `notifyAllowed`.
- `fcmDispatcher.ts` — new `sendCharacterProactive` method (Decision 6).

**Client (root app package) — in scope for the first time**

- Local schema migration adding `read_at INTEGER` to `messages`.
- `messageDatabase.ts` — a proactive-sync insert path implementing Decision 4's
  two phases.
- A sync hook driving `fetchProactiveMessages` on foreground and on push
  receipt, with cursor persistence.
- Character list badge derived from local `read_at IS NULL` counts.
- `markProactiveRead` fired on chat open, queued and retried on failure.

### Ownership and authorization

Both new callables resolve the caller's `users.id` from `request.auth.uid` and
scope every query to characters that user owns, matching the pattern at
`characterFunctions.ts:266`. The client never supplies a user id, and
`fetchProactiveMessages` never accepts a character id it then trusts — it derives
the character set server-side.

Account deletion needs no new work: `adminFunctions.ts:493` already deletes
messages by `senderUserId`, and proactive rows set `sender_user_id` to the owning
user, consistent with how `generateReply.ts:608` uses that column to mean "whose
conversation" rather than "who authored".

---

## Testing

**Framework, per package.** This is the first phase where the client is in
scope, and the packages do not agree:

| Package       | Runner      | Notes                                 |
| ------------- | ----------- | ------------------------------------- |
| `functions`   | `node:test` | Tests run over built output (`lib/`)  |
| `cloud-agent` | `node:test` | Tests run over built output (`dist/`) |
| Client (root) | **Jest**    | `npx jest <path>` to filter           |

Jest syntax is DOA in the two backend packages. `npm test -- <path>` does not
filter at the root.

Baselines to hold: `functions` 499/499; `cloud-agent` 337 pass + 1 known skip;
root 158 suites / 1441 tests.

**What must be covered:**

- **Migration `0028`** — backfill parses each historical `outcome` form correctly
  into **both** columns; a clamped row (`mode=quiet chosen=notify`) yields
  `delivery_mode='quiet'` and `chosen_delivery_mode='notify'`, which is the case
  a single-column design would have lost; rows whose outcome is not a `mode=`
  string keep NULL in both; columns are nullable; `outcome` is left intact;
  running the migration twice is a no-op on already-populated rows.
- **`todaysPushCount` cutover** — counts from `delivery_mode`, and a row whose
  `outcome` text says `mode=notify` but whose column disagrees follows the
  column.
- **`unreadProactiveCount`** — counts only unread proactive messages for that
  character's owner; excludes messages older than the staleness escape;
  returns 0 when none.
- **Guardrail integration** — `notifyAllowed` is false with an unread proactive
  message present, true once it is marked read, and true again once an unread
  message crosses the 7-day escape.
- **Cursor pagination** — a page boundary landing inside a group of rows sharing
  one `created_at` neither skips nor repeats. This is the specific defect the
  tiebreak exists to prevent and must be tested with colliding timestamps, not
  distinct ones.
- **`fetchProactiveMessages` authorization** — rejects unauthenticated; never
  returns another user's messages.
- **`markProactiveRead`** — idempotent; only affects the caller's messages; a
  second call is a no-op rather than an error.
- **Two-phase local write** — `INSERT OR IGNORE` leaves an existing local row's
  `text` and flags untouched; the `read_at` update applies to an existing row;
  a page carrying `read_at = NULL` for a row already marked read locally does
  **not** clear it.
- **`sendCharacterProactive`** — payload carries the character deeplink, not
  `/talk`, and no `BROWSER_ACTION_APPROVAL` category.
- **Mark-read retry** — a failed call is queued and retried rather than dropped.

---

## Risks

**A backfill bug is discovered only in production.** There is no staging
environment, so `0028` is exercised against real rows the first time it runs. The
mitigation is that the backfill is derived and additive — `outcome` is preserved,
so the column can be dropped and recomputed. The migration must be written so
that re-running the backfill is safe.

**Over-notification.** `delivery_mode` has exactly one writer — the cloud-agent's
`resolveWakeup` call — so the risk is not concurrent writers but _unwritten_
rows. A wake-up that dies after sending a push but before resolving leaves
`delivery_mode` NULL, so `todaysPushCount` undercounts and the user can be pushed
past the daily cap. The window is small and bounded by `reapStaleClaims`, and the
cap itself is small (2/day), so the worst case is one extra notification.
Recording the intended mode at claim time instead was rejected: it would
overcount whenever a turn fails, which suppresses real messages — the worse
direction to err in for a re-engagement feature.

**Silent mute.** Addressed by Decision 7, but the residual risk is that the
7-day escape is itself untuned. It is deliberately generous: erring toward "push
again after a week" rather than toward permanent silence.

**Local schema migration failure on device.** The client migration is additive
(`ALTER TABLE messages ADD COLUMN read_at INTEGER`) and follows an established
numbered pattern, but a device that fails it would have a `messages` table the
sync path cannot write. The sync must degrade to "no proactive messages" rather
than throwing into the chat UI.

**Scope creep into two-way sync.** Building a server→device path for proactive
messages invites "while we're here, sync everything." Explicitly out of scope;
the callable is named and shaped for proactive messages only.

---

## Open questions

1. **Badge granularity.** Per-character count, or a single dot? The data supports
   either; the spec assumes a count and the plan should confirm before building
   the list UI.
2. **Push body content.** Does the notification preview the message text, or say
   only that the character wrote? A preview is better engagement and worse
   privacy on a lock screen. Not blocking the backend work.
3. **Cursor persistence location.** The sync cursor could live in local SQLite
   alongside `schema_version`, or in async storage. Local SQLite keeps it
   consistent with the data it describes; to be settled in the plan.
4. **Whether the 7-day escape should also clear the badge.** Currently the escape
   only unblocks pushes; the message stays badged as unread. That is probably
   right — the user genuinely has not read it — but it means a stale unread badge
   can persist indefinitely.

---

## Deliverables

| Item                        | Detail                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| Migration `0028`            | `scheduled_wakeups.delivery_mode` + `chosen_delivery_mode` + guarded backfill; both `db/schema.ts` files |
| Migration `0029`            | `messages.read_at`                                                                                       |
| Local SQLite migration      | `messages.read_at`, next index after `24`                                                                |
| `fetchProactiveMessages`    | New callable, cursor-paginated, account-wide                                                             |
| `markProactiveRead`         | New callable, idempotent                                                                                 |
| `sendCharacterProactive`    | New `fcmDispatcher` method                                                                               |
| `loadContext` rework        | Real `unreadProactiveCount`, column-based push count                                                     |
| Client sync + badge + retry | First client-side work in this feature                                                                   |

## Constraints carried from Phase 1

- `node:test` in `functions` and `cloud-agent`; Jest at the root.
- Migrations are hand-written at the next index and registered in
  `functions/scripts/migrationOrder.mjs` — both runners refuse an unregistered
  file. Do not run `drizzle-kit generate`; the journal is stuck at `0011`.
- Migrations apply as a chain; pass the full `MIGRATIONS` list, not just the
  newest file.
- Budget day is UTC.
- No semicolons, single quotes.
- Formatting and logic never share a commit or branch.
- Preserve the `claimed`/`running` two-status split; narrowing the claim
  predicate to `pending` alone breaks every wake-up.
- Verify after deploying that the new revision actually took traffic.
