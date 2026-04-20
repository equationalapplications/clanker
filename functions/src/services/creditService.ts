import { eq, sql, and, gte } from 'drizzle-orm';
import { getDb } from '../db/cloudSql.js';
import { subscriptions, creditTransactions } from '../db/schema.js';

const UNIQUE_VIOLATION_CODE = '23505';

class InsufficientCreditsError extends Error {
  constructor() {
    super('Insufficient credits');
    this.name = 'InsufficientCreditsError';
  }
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === UNIQUE_VIOLATION_CODE;
}

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
    try {
      return await db.transaction(async (tx) => {
        if (referenceId) {
          try {
            await tx.insert(creditTransactions).values({
              userId,
              delta: -amount,
              reason,
              referenceId,
            });
          } catch (error) {
            if (isUniqueViolation(error)) {
              return true;
            }
            throw error;
          }
        }

        // Use UPDATE ... RETURNING to ensure atomic deduction and prevent negative balance.
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
          throw new InsufficientCreditsError();
        }

        if (!referenceId) {
          await tx.insert(creditTransactions).values({
            userId,
            delta: -amount,
            reason,
            referenceId,
          });
        }

        return true;
      }, {
        isolationLevel: 'read committed', // row-level locking via UPDATE is sufficient for atomic decrement
      });
    } catch (error) {
      if (error instanceof InsufficientCreditsError) {
        return false;
      }
      throw error;
    }
  },

  async addCredits(userId: string, amount: number, reason: string, referenceId?: string): Promise<number> {
    const db = await getDb();
    return await db.transaction(async (tx) => {
      if (referenceId) {
        try {
          await tx.insert(creditTransactions).values({
            userId,
            delta: amount,
            reason,
            referenceId,
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            const current = await tx
              .select({ currentCredits: subscriptions.currentCredits })
              .from(subscriptions)
              .where(eq(subscriptions.userId, userId))
              .limit(1);
            return current[0]?.currentCredits ?? 0;
          }
          throw error;
        }
      }

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

      if (!referenceId) {
        await tx.insert(creditTransactions).values({
          userId,
          delta: amount,
          reason,
          referenceId,
        });
      }

      return updatedCredits;
    });
  },

  async adjustCredits(userId: string, delta: number, reason: string, referenceId?: string): Promise<number> {
    const db = await getDb();
    return await db.transaction(async (tx) => {
      if (referenceId) {
        try {
          await tx.insert(creditTransactions).values({
            userId,
            delta,
            reason,
            referenceId,
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            const current = await tx
              .select({ currentCredits: subscriptions.currentCredits })
              .from(subscriptions)
              .where(eq(subscriptions.userId, userId))
              .limit(1);
            return current[0]?.currentCredits ?? 0;
          }
          throw error;
        }
      }

      const startingCredits = Math.max(0, delta);
      const result = await tx
        .insert(subscriptions)
        .values({
          userId,
          currentCredits: startingCredits,
        })
        .onConflictDoUpdate({
          target: subscriptions.userId,
          set: {
            currentCredits: sql`GREATEST(${subscriptions.currentCredits} + ${delta}, 0)`,
            updatedAt: new Date(),
          },
        })
        .returning({ currentCredits: subscriptions.currentCredits });

      const updatedCredits = result[0].currentCredits;

      if (!referenceId) {
        await tx.insert(creditTransactions).values({
          userId,
          delta,
          reason,
          referenceId,
        });
      }

      return updatedCredits;
    });
  },
};
