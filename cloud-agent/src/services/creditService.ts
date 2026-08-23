import { sql } from 'drizzle-orm'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import type * as schema from '../db/schema.js'
import type { DrizzleClient } from '../db/client.js'

export type CreditSpendAllocation = {
  transactionId: string
  amount: number
}

export type CreditService = {
  spendCredit: (userId: string, amount: number, reason: string) => Promise<CreditSpendAllocation[]>
  refundCredit: (userId: string, allocations: CreditSpendAllocation[]) => Promise<void>
  getBalance: (userId: string) => Promise<number>
}

function assertPositiveCreditAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('INVALID_CREDIT_AMOUNT')
  }
}

// NOT NULL alone does not keep a blank reason out of credit_spend_events —
// an empty or whitespace-only value would persist as an unusable attribution
// row. Reject it before the transaction opens and persist the trimmed value.
function normalizeSpendReason(reason: string): string {
  const normalized = typeof reason === 'string' ? reason.trim() : ''
  if (!normalized) {
    throw new Error('INVALID_SPEND_REASON')
  }
  return normalized
}

// The tx handle Drizzle hands to a transaction() callback — spelled via
// drizzle's exported PgTransaction type rather than NodePgDatabase, whose
// required $client property no transaction-scoped handle carries.
type CreditMutationTx = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

// Update subscriptions cache (row is already locked by the outer tx). Best-effort
// — but a bare try/catch cannot deliver that: a Postgres error here aborts the
// WHOLE transaction (25P02), and Drizzle's final COMMIT on an aborted
// transaction acts as ROLLBACK, silently discarding the spend/refund above
// while callers still see success. The SAVEPOINT isolates the failure so only
// the cache write rolls back and the outer commit stays real.
// credit_transactions is the source of truth; this column is a denormalized
// cache recomputed on each mutation.
async function syncSubscriptionsCacheBestEffort(
  tx: CreditMutationTx,
  userId: string,
  direction: 'decrement' | 'increment',
): Promise<void> {
  await tx
    .transaction(async (cacheTx) => {
      await cacheTx.execute(sql`
        UPDATE subscriptions
        SET current_credits = (
          SELECT GREATEST(COALESCE(SUM(remaining_balance), 0), 0)
          FROM credit_transactions
          WHERE user_id = ${userId}
            AND (expires_at IS NULL OR expires_at > NOW())
        )
        WHERE user_id = ${userId}
      `)
    })
    .catch((err) => {
      console.warn(`subscriptions.current_credits ${direction} failed user=${userId}`, err)
    })
}

export function createCreditService(db: DrizzleClient): CreditService {
  return {
    async spendCredit(
      userId: string,
      amount: number,
      reason: string,
    ): Promise<CreditSpendAllocation[]> {
      assertPositiveCreditAmount(amount)
      const reasonText = normalizeSpendReason(reason)
      // Match functions/ lock order to prevent deadlocks:
      // 1. Ensure subscriptions row exists and lock it first
      // 2. Then lock and update credit_transactions
      return await db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO subscriptions (user_id, current_credits)
          VALUES (${userId}, 0)
          ON CONFLICT (user_id) DO NOTHING
        `)

        await tx.execute(sql`
          SELECT user_id FROM subscriptions
          WHERE user_id = ${userId}
          FOR UPDATE
        `)

        // Ensure the user has a non-negative net active balance (adjustments can create negative rows).
        const netResult = await tx.execute<{ total: string | null }>(sql`
          SELECT GREATEST(COALESCE(SUM(remaining_balance), 0), 0) AS total
          FROM credit_transactions
          WHERE user_id = ${userId}
            AND (expires_at IS NULL OR expires_at > NOW())
        `)
        const netCredits = Number(netResult.rows[0]?.total ?? 0)
        if (netCredits < amount) {
          throw new Error('INSUFFICIENT_CREDITS')
        }

        // Lock every qualifying row FIFO (expiring soonest first), then allocate
        // the requested amount across as many rows as needed.
        const rows = await tx.execute<{ id: string; remaining_balance: string }>(sql`
          SELECT id, remaining_balance FROM credit_transactions
          WHERE user_id = ${userId}
            AND remaining_balance > 0
            AND (expires_at IS NULL OR expires_at > NOW())
          ORDER BY expires_at ASC NULLS LAST, id ASC
          FOR UPDATE
        `)

        let remaining = amount
        const allocations: CreditSpendAllocation[] = []
        for (const row of rows.rows) {
          if (remaining <= 0) break
          const take = Math.min(Number(row.remaining_balance), remaining)
          await tx.execute(sql`
            UPDATE credit_transactions
            SET remaining_balance = remaining_balance - ${take}
            WHERE id = ${row.id}
          `)
          allocations.push({ transactionId: row.id, amount: take })
          remaining -= take
        }

        if (remaining > 0 || allocations.length === 0) {
          // Net balance passed under lock but rows could not cover it — should be unreachable.
          throw new Error('INSUFFICIENT_CREDITS')
        }

        // Attribution ledger — same transaction as the spend, so it commits,
        // and rolls back, atomically with it.
        await tx.execute(sql`
          INSERT INTO credit_spend_events (user_id, amount, reason)
          VALUES (${userId}, ${amount}, ${reasonText})
        `)

        await syncSubscriptionsCacheBestEffort(tx, userId, 'decrement')

        return allocations
      })
    },

    async refundCredit(userId: string, allocations: CreditSpendAllocation[]): Promise<void> {
      if (allocations.length === 0) {
        return
      }
      for (const { amount } of allocations) {
        assertPositiveCreditAmount(amount)
      }

      await db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO subscriptions (user_id, current_credits)
          VALUES (${userId}, 0)
          ON CONFLICT (user_id) DO NOTHING
        `)

        await tx.execute(sql`
          SELECT user_id FROM subscriptions
          WHERE user_id = ${userId}
          FOR UPDATE
        `)

        for (const { transactionId, amount } of allocations) {
          const updated = await tx.execute<{ id: string }>(sql`
            UPDATE credit_transactions
            SET remaining_balance = remaining_balance + ${amount}
            WHERE id = ${transactionId}
              AND user_id = ${userId}
              AND (expires_at IS NULL OR expires_at > NOW())
            RETURNING id
          `)

          if (updated.rows.length === 0) {
            // Original row expired between spend and refund; insert a non-expiring compensation.
            await tx.execute(sql`
              INSERT INTO credit_transactions (
                user_id, delta, reason, initial_amount, remaining_balance, transaction_type, expires_at
              )
              VALUES (${userId}, ${amount}, 'refund_compensation', ${amount}, ${amount}, 'legacy', NULL)
            `)
          }
        }

        await syncSubscriptionsCacheBestEffort(tx, userId, 'increment')
      })
    },

    async getBalance(userId: string): Promise<number> {
      const result = await db.execute<{ total: string | null }>(sql`
        SELECT GREATEST(COALESCE(SUM(remaining_balance), 0), 0) AS total
        FROM credit_transactions
        WHERE user_id = ${userId}
          AND (expires_at IS NULL OR expires_at > NOW())
      `)
      const total = result.rows[0]?.total
      return total !== null && total !== undefined ? Number(total) : 0
    },
  }
}
