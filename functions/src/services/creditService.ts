import { eq, sql, and, gte } from 'drizzle-orm';
import { db } from '../db/cloudSql.js';
import { subscriptions, creditTransactions } from '../db/schema.js';

export const creditService = {
  async getCredits(userId: string): Promise<number> {
    const result = await db
      .select({ currentCredits: subscriptions.currentCredits })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1);

    return result[0]?.currentCredits ?? 0;
  },

  async spendCredits(userId: string, amount: number, reason: string, referenceId?: string): Promise<boolean> {
    return await db.transaction(async (tx) => {
      // Use UPDATE ... RETURNING to ensure atomic deduction and prevent negative balance
      const result = await tx
        .update(subscriptions)
        .set({ currentCredits: sql`${subscriptions.currentCredits} - ${amount}` })
        .where(
          and(
            eq(subscriptions.userId, userId),
            gte(subscriptions.currentCredits, amount)
          )
        )
        .returning({ updatedCredits: subscriptions.currentCredits });

      if (result.length === 0) {
        // Either user not found or not enough credits
        return false;
      }

      await tx.insert(creditTransactions).values({
        userId,
        delta: -amount,
        reason,
        referenceId,
      });

      return true;
    }, {
      isolationLevel: 'read committed', // row-level locking via UPDATE is sufficient for atomic decrement
    });
  },

  async addCredits(userId: string, amount: number, reason: string, referenceId?: string): Promise<number> {
    return await db.transaction(async (tx) => {
      // Check if subscription exists, if not, wait for it or insert default?
      // Typically subscription should exist by the time we add credits.
      const existing = await tx.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);

      let updatedCredits = 0;

      if (existing.length > 0) {
        const result = await tx
          .update(subscriptions)
          .set({ currentCredits: sql`${subscriptions.currentCredits} + ${amount}` })
          .where(eq(subscriptions.userId, userId))
          .returning({ currentCredits: subscriptions.currentCredits });
        
        updatedCredits = result[0].currentCredits;
      } else {
        const result = await tx.insert(subscriptions).values({
          userId,
          currentCredits: amount,
        }).returning({ currentCredits: subscriptions.currentCredits });

        updatedCredits = result[0].currentCredits;
      }

      await tx.insert(creditTransactions).values({
        userId,
        delta: amount,
        reason,
        referenceId,
      });

      return updatedCredits;
    });
  },
};
