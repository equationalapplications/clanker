import { sql } from 'drizzle-orm'
import type { DrizzleClient } from '../db/client.js'

export type CreditService = {
  spendCredit: (userId: string) => Promise<string>
  refundCredit: (userId: string, txId: string) => Promise<void>
  getBalance: (userId: string) => Promise<number>
}

export function createCreditService(db: DrizzleClient): CreditService {
  return {
    async spendCredit(userId: string): Promise<string> {
      // Atomically selects the earliest-expiring row with remaining_balance >= 1
      // and decrements it. Returns 0 rows if no qualifying row exists.
      // Two concurrent requests with 1 credit: PostgreSQL row locking ensures
      // only one succeeds; the second sees remaining_balance = 0 and returns 0 rows.
      const spendResult = await db.execute<{ id: string }>(sql`
        UPDATE credit_transactions
        SET remaining_balance = remaining_balance - 1
        WHERE user_id = ${userId}
          AND remaining_balance >= 1
          AND (expires_at IS NULL OR expires_at > NOW())
          AND id = (
            SELECT id FROM credit_transactions
            WHERE user_id = ${userId}
              AND remaining_balance >= 1
              AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY expires_at ASC NULLS LAST
            LIMIT 1 FOR UPDATE
          )
        RETURNING id
      `)

      if (spendResult.rows.length === 0) {
        throw new Error('INSUFFICIENT_CREDITS')
      }

      const txId = spendResult.rows[0].id

      try {
        await db.execute(sql`
          UPDATE subscriptions
          SET current_credits = current_credits - 1
          WHERE user_id = ${userId}
        `)
      } catch (err) {
        // Best-effort cache sync; credit_transactions is the source of truth.
        console.warn(`subscriptions.current_credits decrement failed user=${userId}`, err)
      }

      return txId
    },

    async refundCredit(userId: string, txId: string): Promise<void> {
      await db.execute(sql`
        UPDATE credit_transactions
        SET remaining_balance = remaining_balance + 1
        WHERE id = ${txId}
          AND user_id = ${userId}
      `)

      await db.execute(sql`
        UPDATE subscriptions
        SET current_credits = current_credits + 1
        WHERE user_id = ${userId}
      `)
    },

    async getBalance(userId: string): Promise<number> {
      const result = await db.execute<{ total: string | null }>(sql`
        SELECT COALESCE(SUM(remaining_balance), 0) AS total
        FROM credit_transactions
        WHERE user_id = ${userId}
          AND (expires_at IS NULL OR expires_at > NOW())
      `)
      const total = result.rows[0]?.total
      return total !== null && total !== undefined ? Number(total) : 0
    },
  }
}