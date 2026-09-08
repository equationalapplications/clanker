// Phase 1 proactive-scheduler telemetry.
//
// The Phase 2 spec's rollout gate requires re-running these queries and
// revisiting DAILY_PROACTIVE_POWER_CEILING, PROACTIVE_NOTIFY_COOLDOWN_MS and
// MAX_PROACTIVE_PUSHES_PER_DAY against the observed distribution before any
// build that can deliver a user-visible push ships. That gate is only
// enforceable if the queries are repeatable, so they live here rather than in
// a handoff document.
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

const QUERIES = [
  ['total wake-ups', 'SELECT count(*) AS total FROM scheduled_wakeups'],
  ['by status', 'SELECT status, count(*) FROM scheduled_wakeups GROUP BY status ORDER BY 2 DESC'],
  [
    'raw outcome distribution',
    "SELECT outcome, count(*) FROM scheduled_wakeups WHERE outcome LIKE 'mode=%' GROUP BY outcome ORDER BY 2 DESC",
  ],
  [
    'chosen vs effective (THE Phase 1 deliverable) — chosen is what the character WANTED',
    `SELECT split_part(outcome, 'chosen=', 2) AS chosen,
            split_part(split_part(outcome, 'mode=', 2), ' ', 1) AS effective,
            count(*)
       FROM scheduled_wakeups
      WHERE outcome LIKE 'mode=%'
      GROUP BY 1, 2
      ORDER BY 3 DESC`,
  ],
  [
    'CLAMP RATE — how often notify was downgraded by the guardrails',
    `SELECT count(*) FILTER (WHERE outcome LIKE '% chosen=notify') AS wanted_notify,
            count(*) FILTER (WHERE outcome LIKE 'mode=notify %') AS actually_notified,
            count(*) FILTER (
              WHERE outcome LIKE '% chosen=notify' AND outcome NOT LIKE 'mode=notify %'
            ) AS clamped,
            round(
              100.0 * count(*) FILTER (
                WHERE outcome LIKE '% chosen=notify' AND outcome NOT LIKE 'mode=notify %'
              ) / nullif(count(*) FILTER (WHERE outcome LIKE '% chosen=notify'), 0),
              1
            ) AS clamped_pct
       FROM scheduled_wakeups
      WHERE outcome LIKE 'mode=%'`,
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
