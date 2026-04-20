import { eq, sql, and, gte } from 'drizzle-orm';
import { getDb } from '../db/cloudSql.js';
import { subscriptions, creditTransactions } from '../db/schema.js';

export const creditService = {
  async getCredits(userId: string): Promise<number> {
    const db = await getDb();
    const result = await db
      .select({ currentCredits: subscriptions.currentCredits })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1);

    return result[0]?.currentCredits ?? 0;
  },

  async spendCredits(userId: string, amount: number, reason: string, referenceId?: string): Promise<boolean> {
    const db = await getDb();
    return await db.transaction(async (tx) => {
      // Use UPDATE ... RETURNING to ensure atomic deduction and prevent negative balance
      const result = await tx
        .update(subscriptions)
        .set({ currentCredits: sql`${subscriptions.currentCredits} - ${amount}` })
        .where(
          and(
            eq(subscriptions.userId, userId),
            eq(subscriptions.planStatus, 'active'),
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
    const db = await getDb();
    return await db.transaction(async (tx) => {
      const result = await tx
        .insert(subscriptions)
        .values({
          userId,
          currentCredits: amount,
        })
        .onConflictDoUpdate({
          target: subscriptions.userId,
          set: {
            currentCredits: sql`${subscriptions.currentCredits} + ${amount}`,
            updatedAt: new Date(),
          },
        })
        .returning({ currentCredits: subscriptions.currentCredits });

      const updatedCredits = result[0].currentCredits;

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
