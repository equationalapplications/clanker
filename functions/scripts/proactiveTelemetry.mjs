// Phase 1 proactive-scheduler telemetry.
//
// The Phase 2 spec's rollout gate requires re-running these queries and
// revisiting DAILY_PROACTIVE_POWER_CEILING, PROACTIVE_NOTIFY_COOLDOWN_MS and
// MAX_PROACTIVE_PUSHES_PER_DAY against the observed distribution before any
// build that can deliver a user-visible push ships. That gate is only
// enforceable if the queries are repeatable, so they live here rather than in
// a handoff document.
//
// Reads the delivery mode from the `delivery_mode` / `chosen_delivery_mode`
// columns added by migration 0028, not by string-matching `outcome`. Parsing
// free text was the defect 0028 exists to remove; leaving it here would have
// meant the rollout gate's own tooling still read the replaced field.
//
// Read-only. Runs against whichever instance the CLOUD_SQL_* env vars point at.
// Must stay inside functions/ so it resolves @google-cloud/cloud-sql-connector
// and pg from functions/node_modules.
//
// Usage (see docs/db-migrations.md for the secret fetch):
//   node scripts/proactiveTelemetry.mjs

import { Connector } from '@google-cloud/cloud-sql-connector'
import pg from 'pg'

const required = [
  'CLOUD_SQL_CONNECTION_NAME',
  'CLOUD_SQL_DB_USER',
  'CLOUD_SQL_DB_PASS',
  'CLOUD_SQL_DB_NAME',
]
const missing = required.filter((name) => !process.env[name])
if (missing.length > 0) {
  console.error(`Missing env vars: ${missing.join(', ')}`)
  process.exit(1)
}

// The clamp-rate building blocks, composed so the predicates cannot drift:
// a "resolved notify wish" is a chosen notify with a KNOWN effective mode,
// and a "clamped notify" is exactly that plus a downgrade. clamped_pct is the
// number the Phase 2 rollout gate tunes caps against, so its numerator and
// denominator must stay in this relationship — hand-maintained copies of the
// predicate are how the percentage silently stops matching the count printed
// beside it.
const RESOLVED_NOTIFY = `chosen_delivery_mode = 'notify' AND delivery_mode IS NOT NULL`
const CLAMPED_NOTIFY = `${RESOLVED_NOTIFY} AND delivery_mode <> 'notify'`

const QUERIES = [
  ['total wake-ups', 'SELECT count(*) AS total FROM scheduled_wakeups'],
  ['by status', 'SELECT status, count(*) FROM scheduled_wakeups GROUP BY status ORDER BY 2 DESC'],
  [
    'raw outcome distribution (resolved rows with no delivery mode: skips and failures)',
    // `outcome IS NOT NULL` is load-bearing, not tidiness. outcome is written
    // only when a row is resolved, so `delivery_mode IS NULL` on its own also
    // matches the entire un-resolved backlog (pending/claimed/running). In
    // production that backlog is larger than the resolved skips, so the report
    // led with a single `outcome=NULL | count=<backlog>` row and buried the
    // actual skip reasons this query exists to show.
    `SELECT outcome, count(*)
       FROM scheduled_wakeups
      WHERE delivery_mode IS NULL AND outcome IS NOT NULL
      GROUP BY outcome
      ORDER BY 2 DESC`,
  ],
  [
    'chosen vs effective (THE Phase 1 deliverable) — chosen is what the character WANTED',
    // Filtered on chosen_delivery_mode, not delivery_mode, so a row that
    // recorded a choice but no effective mode still appears — as its own
    // `effective=NULL` row in the GROUP BY, where it is visible rather than
    // silently dropped. No writer produces that shape today (the success path
    // in proactiveWakeupHandler writes both columns in one resolveWakeup, and
    // the 0028 backfill derives both from the same `mode=X chosen=Y` string),
    // so a non-empty effective=NULL row means something new is writing a
    // partial pair and the clamp rate below needs re-reading before it is
    // trusted.
    //
    // Known gap: if cloud-agent rolls back to or lags at a pre-0028 revision
    // after the backfill has run, new rows carry outcome text but NULL columns
    // and drop out of this query's denominator entirely (they resurface in the
    // raw outcome distribution above as mode=/chosen= rows). Re-running 0028's
    // IS-NULL-guarded UPDATEs re-captures them; parsing outcome text here
    // instead would reintroduce the defect 0028 exists to remove.
    `SELECT chosen_delivery_mode AS chosen,
            delivery_mode AS effective,
            count(*)
       FROM scheduled_wakeups
      WHERE chosen_delivery_mode IS NOT NULL
      GROUP BY 1, 2
      ORDER BY 3 DESC`,
  ],
  [
    'CLAMP RATE — how often a chosen notify was downgraded (see gate warning)',
    // WARNING — while PROACTIVE_PUSH_ENABLED is false in cloud-agent's
    // proactiveWakeupHandler, EVERY chosen=notify lands as quiet: the push
    // gate clamps and is recorded identically to a guardrail clamp in these
    // columns (delivery_mode='quiet', chosen_delivery_mode='notify'), so
    // clamped_pct reads ~100 and mixes both kinds. Do NOT tune
    // PROACTIVE_NOTIFY_COOLDOWN_MS or MAX_PROACTIVE_PUSHES_PER_DAY from this
    // number alone — split it with the clamp-reason query below, which reads
    // the clamp=<reason> suffix the handler records in outcome. Rows written
    // before that suffix existed (and any rollback/lag window) fall into its
    // 'unlabelled' bucket and cannot be split after the fact.
    //
    // clamped_pct = clamped / resolved notify wishes: rows whose chosen mode
    // was notify but whose turn never resolved to an effective mode (failures,
    // partial pairs) are excluded from BOTH the numerator and the denominator.
    // Including them in the denominator would dilute the percentage with rows
    // that say nothing about clamping, understating the clamp rate — the
    // direction that wrongly loosens PROACTIVE_NOTIFY_COOLDOWN_MS /
    // MAX_PROACTIVE_PUSHES_PER_DAY. Those rows are not discarded: they are
    // counted as chosen_notify_unresolved below, and a high value there means
    // clamped_pct is computed on a shrinking sample and must be read with that
    // column beside it.
    `SELECT count(*) FILTER (WHERE chosen_delivery_mode = 'notify') AS wanted_notify,
            count(*) FILTER (WHERE delivery_mode = 'notify') AS actually_notified,
            count(*) FILTER (WHERE ${CLAMPED_NOTIFY}) AS clamped,
            round(
              100.0 * count(*) FILTER (WHERE ${CLAMPED_NOTIFY})
                / nullif(count(*) FILTER (WHERE ${RESOLVED_NOTIFY}), 0),
              1
            ) AS clamped_pct,
            count(*) FILTER (
              WHERE chosen_delivery_mode = 'notify' AND delivery_mode IS NULL
            ) AS chosen_notify_unresolved
       FROM scheduled_wakeups
      WHERE chosen_delivery_mode IS NOT NULL`,
  ],
  [
    'CLAMP REASONS — gate vs guardrail split of the clamped notifies above',
    // The columns cannot distinguish the two clamps, so this query reads the
    // clamp=<reason> suffix the handler appends to outcome. It parses exactly
    // that one deliberately-written field — not a reintroduction of the
    // outcome-LIKE parsing 0028 removed, which guessed delivery semantics
    // from prose. 'guardrail' is the signal the rollout gate tunes
    // PROACTIVE_NOTIFY_COOLDOWN_MS / MAX_PROACTIVE_PUSHES_PER_DAY against:
    // the guardrails blocked a notify the push gate would have allowed.
    // 'gate' means the guardrails WOULD have permitted the push. 'unlabelled'
    // covers rows written before the suffix existed or during a
    // rollback/lag window — those are permanently ambiguous, which is why
    // this landed before the gate opens.
    `SELECT coalesce(
              substring(outcome from 'clamp=([a-z]+)'),
              'unlabelled'
            ) AS clamp_reason,
            count(*)
       FROM scheduled_wakeups
      WHERE chosen_delivery_mode = 'notify'
        AND delivery_mode IS NOT NULL
        AND delivery_mode <> 'notify'
      GROUP BY 1
      ORDER BY 2 DESC`,
  ],
  [
    'skip reasons — are the guardrails too tight?',
    "SELECT outcome, count(*) FROM scheduled_wakeups WHERE status = 'skipped' GROUP BY outcome ORDER BY 2 DESC",
  ],
  [
    'real money spent on background turns',
    "SELECT count(*) AS turns, coalesce(sum(amount), 0) AS total FROM credit_spend_events WHERE reason = 'proactive_wakeup'",
  ],
  [
    'stale claims — should be empty; any row is the reaper catching a real failure',
    "SELECT count(*) AS stale FROM scheduled_wakeups WHERE outcome = 'stale_claim'",
  ],
  [
    'scheduling spread — how many distinct characters have scheduled anything',
    'SELECT count(DISTINCT character_id) AS characters FROM scheduled_wakeups',
  ],
]

const connector = new Connector()
let client

try {
  const options = await connector.getOptions({
    instanceConnectionName: process.env.CLOUD_SQL_CONNECTION_NAME,
    ipType: 'PUBLIC',
  })
  client = new pg.Client({
    ...options,
    user: process.env.CLOUD_SQL_DB_USER,
    password: process.env.CLOUD_SQL_DB_PASS,
    database: process.env.CLOUD_SQL_DB_NAME,
  })
  await client.connect()

  console.log(`instance: ${process.env.CLOUD_SQL_CONNECTION_NAME}`)
  console.log(`database: ${process.env.CLOUD_SQL_DB_NAME}`)

  for (const [label, sql] of QUERIES) {
    console.log(`\n== ${label} ==`)
    try {
      const result = await client.query(sql)
      if (result.rows.length === 0) {
        console.log('(no rows)')
      } else {
        console.table(result.rows)
      }
    } catch (err) {
      // One failing query must not hide the rest: a missing table is itself a
      // useful answer.
      console.log(`ERROR: ${err.message}`)
    }
  }
} finally {
  if (client) await client.end().catch(() => {})
  connector.close()
}
