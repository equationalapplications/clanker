# Proactive Character Scheduler — Design

**Date:** 2026-09-08
**Status:** Draft — awaiting review
**Scope:** Phase 1 (server-side, silent) is this spec's deliverable. Phase 2 (client delivery) is specified at a lower resolution and gets its own spec before implementation.

## Problem

Clanker characters can only act while a user is actively typing at them. The
schema was built for more than that: `agent_tasks` carries `status`, `priority`
and `due_context`; `memory_events` records `observation | decision | action |
outcome`. That is an autonomous agent loop with no heartbeat. The one
`onSchedule` in the repo is `imageRetentionSweep`.

The gap is visible to users today. `cloud-agent/src/tools/reminders.ts` exposes
`set_reminder` to the model, logs the request, and returns `Reminder set:
"<message>" for <time>.` Nothing is scheduled. A character can promise a
follow-up it is structurally incapable of making.

The goal is characters that do things between conversations — noticing on
Tuesday that you mentioned an interview, and asking on Thursday how it went.

## Goals

- A character can schedule its own future wake-up and have it actually run.
- A wake-up runs a full agent turn: same tools, same memory, no user present.
- Background spend is bounded per character per day and never surprises the user.
- The whole feature is disabled by pausing a single Cloud Scheduler job.

## Non-goals

- Second-accurate firing. Five-minute granularity is sufficient and arguably
  more natural for human-scale follow-ups.
- Proactive turns for users with no power. They are skipped, not deferred or queued.
- Cross-character or cross-user coordination.
- Phase 1 does not deliver any user-visible message. See §4.

## Decisions

Recorded with reasoning, because several were close calls.

**Cron sweep, not Cloud Tasks.** A five-minute `onSchedule` sweep over a due
table needs no new infrastructure — `onSchedule` and the `SCHEDULER_SECRET`
bearer pattern are both already in production — and it puts every spend decision
in one readable function. Cloud Tasks would fire more precisely but scatters the
guardrails to execution time, adds a queue and IAM wiring, and requires tracking
task names to support cancellation. Given the pending sale, one pausable cron job
with centralized guardrails is a materially better artifact to hand a buyer. The
`scheduled_wakeups` table is exactly the state a Cloud Tasks migration would
need, so that door stays open.

**The character decides the delivery mode; the code can veto.** The model picks
`notify | quiet | silent` per wake-up. The handler downgrades `notify` when the
daily cap or the cooldown says so. The model proposes, the code disposes.

**Both a cap and a cooldown.** A counted daily ceiling alone permits a character
to push into a void; a cooldown alone permits a burst. Both are enforced in the
sweeper as pure functions.

**Budget is expressed in power, not wake-up counts.** A wake-up that drives heavy
inference should consume more of the allowance than a cheap one, and this keeps
one unified billing model rather than two. The daily figure is derived rather than
counted in a column that needs keeping consistent. Note that
`credit_spend_events` cannot be that source: it records `user_id`, `amount` and
`reason` only, with no `character_id`, so a per-character figure is not
recoverable from it. The amount actually spent is therefore recorded on the
wake-up row itself, and the daily figure is a sum over those rows.
`credit_spend_events` remains the global attribution ledger, unchanged.

**Available to everyone; skipped when power is low.** No subscriber gate, no
opt-in. A due wake-up whose cost exceeds the user's balance is marked `skipped`
and dropped. Free users can spend their signup grant on background turns; that is
accepted, and is the point of the feature as an acquisition lever.

**The model is not told its remaining budget.** A number rendered into the system
prompt is stale by the time the wake-up fires, and the model will surface it to
the user, which violates the rule that exact charges are never shown. Instead the
`set_reminder` tool's return value reports refusal at the moment of scheduling —
the 429 model, not a live quota gauge.

## Architecture

```
set_reminder tool (cloud-agent)      →  INSERT scheduled_wakeups (pending)
        │
        ▼
proactiveWakeupSweep (functions)     ←  onSchedule, every 5 minutes
   guardrails → claim → POST
        │
        ▼
POST /agent/proactive-wakeup         →  ADK turn, spend, deliver_wakeup tool
   (cloud-agent, SCHEDULER_SECRET)
        │
        ▼
Phase 1: memory/tasks/wiki writes only.
Phase 2: messages row + fetchProactiveMessages + push hint.
```

### §1 Data model

Migration `functions/drizzle/0026_scheduled_wakeups.sql`, hand-written at the
next index (do not run `drizzle-kit generate`; the journal is out of sync), with
matching Drizzle definitions in both `functions/src/db/schema.ts` and
`cloud-agent/src/db/schema.ts`.

`scheduled_wakeups`:

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `character_id` | uuid NOT NULL | FK `characters.id`, cascade |
| `user_id` | uuid NOT NULL | FK `users.id`, cascade |
| `reason` | text NOT NULL | the character's note to itself |
| `due_at` | timestamptz NOT NULL | |
| `priority` | integer NOT NULL default 0 | tie-break when over budget; mirrors `agent_tasks` |
| `status` | text NOT NULL default `'pending'` | check: `pending, claimed, done, skipped, cancelled` |
| `run_key` | text NOT NULL | unique; idempotency across sweeps and retries |
| `claimed_at` | timestamptz | |
| `resolved_at` | timestamptz | |
| `spent_amount` | integer NOT NULL default 0 | power actually consumed; the per-character daily budget sums this |
| `outcome` | text | short note: delivery mode used, or skip reason |
| `created_at` | timestamptz NOT NULL default now() | |

Indexes: `(status, due_at)` for the sweep; `(character_id, status)` for the cap
check; unique on `run_key`.

No new budget table. Today's background spend for a character is `SUM(spent_amount)`
over `scheduled_wakeups` for that `character_id` with `resolved_at` since local
midnight, served by the `(character_id, status)` index. The handler writes
`spent_amount` back on completion, and a refunded turn writes zero — so a wake-up
that failed and was refunded does not consume the day's allowance.

### §2 The sweeper

`functions/src/proactiveWakeupSweep.ts`, modelled directly on
`imageRetention.ts`: `onSchedule({ schedule: 'every 5 minutes', region:
'us-central1', secrets: [...CLOUD_SQL_SECRETS] })`, with the body delegating to
an exported, dependency-injected `proactiveWakeupSweepHandler` so it is testable
without the scheduler.

Per run:

1. Select `pending` rows with `due_at <= now()`, ordered by `priority DESC,
   due_at ASC`, bounded by a batch limit.
2. For each row, evaluate the guardrails — pure functions over
   `(lastUserMessageAt, todaysProactiveSpend, unreadProactiveCount, balance)`:
   - **Balance**: skip if `balance < AGENT_TURN_CREDIT_COST`.
   - **Daily cap**: skip if `SUM(spent_amount)` for this character since local
     midnight is at or over the ceiling. Because a turn's true cost is known
     only after it runs, the check is "is there ceiling left", not "does this
     turn fit" — a final wake-up may cross the line, and the next is refused.
     Overshoot is bounded by one turn.
   - **Cooldown**: a `notify` outcome is not permitted within the cooldown
     window of the user's last message, nor while an earlier proactive message
     is unread. The wake-up still runs; only its delivery mode is constrained.
     (In Phase 1 every wake-up is silent, so the cooldown is computed, recorded,
     and asserted in tests, but has no user-visible effect yet.)
3. Claim survivors with a conditional update — `UPDATE ... SET status='claimed'
   WHERE id = $1 AND status = 'pending'` — so two overlapping sweeps cannot
   double-fire the same row. A zero-row result means another sweep won; skip.
4. POST each claimed row to cloud-agent with the `SCHEDULER_SECRET` bearer.
5. Record the outcome on the row.

Skipped rows are terminal, not retried: `status='skipped'` with the reason in
`outcome`. A wake-up that was worth doing at 09:00 is usually not worth doing at
17:00, and retrying is how a low-balance user's queue turns into a thundering
herd the moment they top up.

**New seam.** `functions` has never called `cloud-agent` — there is no
`CLOUD_AGENT_URL` anywhere in the codebase. This introduces a config value plus
the shared secret. `SCHEDULER_SECRET` must have a Secret Manager *version*
before the first deploy that references it, or the deploy fails.

### §3 The cloud-agent endpoint

`POST /agent/proactive-wakeup` in `cloud-agent/src/handlers/proactiveWakeupHandler.ts`,
a structural sibling of `schedulerTriggerHandler.ts` and reusing its proven
pieces: `createRequireSchedulerSecret` for auth, a rate limiter, `run_key`
reservation for idempotency, and `spendCredit` / `refundCredit` with rollback on
setup failure.

The turn itself is a normal ADK run with the character's full tool set and
memory, seeded with the wake-up `reason` in place of a user message, and billed
through the existing `consumeAgentEvents` path so per-loop metering and the
`MAX_LOOP_ITERATIONS` cap apply unchanged. The spend reason is
`proactive_wakeup`, added to the reason vocabulary in
`docs/billing-and-credits.md`.

A new `deliver_wakeup` tool ends the turn, taking `mode: notify | quiet |
silent` and the message text. This is where "the character decides" is
expressed and where the code's veto is applied. In Phase 1 the handler accepts
the tool call, records the mode the model chose in `outcome`, and delivers
nothing — which yields real production data on how often characters *would*
have notified, before any user can be interrupted by one.

`set_reminder` stops being a stub: it inserts a `pending` row and returns either
confirmation or, when the character is at its daily ceiling, a refusal the model
can react to in the same turn.

### §4 Delivery (Phase 2 — not implemented in this spec)

Recorded so Phase 1 does not foreclose it.

Chat history for the cloud-agent path lives in local SQLite on the device
(`src/database/messageDatabase.ts`, read via `useMessages`). The server
`messages` table is written only by the legacy `generateReply` path, and no
callable pulls messages down — `getUserCharacters` and `syncCharacterImages`
sync down, messages never do.

Phase 2 therefore adds: a `messages` row written by the handler (its unique
`message_id` gives idempotency for free); a `fetchProactiveMessages(characterId,
since)` callable; client-side insertion into local SQLite with unread state; and
`fcm.sendProactive` — already built — as a *hint to sync* only, never the
carrier. A dropped push then costs timeliness, not the message, and web, which
has no push, still works on next open.

## Testing

- **Sweeper** (`functions`, Jest): guardrail functions table-driven across
  balance, cap and cooldown boundaries, including the single-turn overshoot and
  the refunded-turn-does-not-consume-allowance case; the claim race, asserting the second
  claimant gets zero rows; batch ordering by priority; skip-is-terminal.
- **Endpoint** (`cloud-agent`, `node:test` — Jest syntax does not run in that
  package): secret rejection, `run_key` idempotency including the duplicate-run
  path, spend-then-refund on setup failure, `deliver_wakeup` mode
  recording, and `spent_amount` write-back (zero on refund).
- **Tool**: `set_reminder` inserts a row; returns refusal at the ceiling.
- No live-LLM tests.

## Risks

- **Unattended spend.** The mitigation is the cap, the balance check, and the
  fact that Phase 1 spends only while nobody can see a result — which is
  precisely why Phase 1 exists: the burn is observable in
  `credit_spend_events` before it is user-visible.
- **A model that over-schedules.** Bounded by the ceiling and by
  `set_reminder`'s refusal path; excess rows are dropped by the sweeper.
- **Deploy verification.** Per prior incidents, confirm the new cloud-agent
  revision actually took traffic after deploying; a healthy revision serving 0%
  has happened here before.

## Open questions

None blocking. The cap and cooldown *values* are configuration, to be chosen
during implementation and tuned against Phase 1's observed data before Phase 2
makes any of it visible.
