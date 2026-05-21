import { eq, sql, and, or, isNull, gt } from 'drizzle-orm';
import { getDb } from '../db/cloudSql.js';
import { subscriptions, creditTransactions } from '../db/schema.js';
import type { TransactionType } from '../db/schema.js';

const UNIQUE_VIOLATION_CODE = '23505';

class InsufficientCreditsError extends Error {
  constructor() {
    super('Insufficient credits');
    this.name = 'InsufficientCreditsError';
  }
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === UNIQUE_VIOLATION_CODE
  );
}

export function assertIdempotentDeltaMatch(params: {
  requestedDelta: number;
  existingDelta: number | null;
  reason: string;
  referenceId: string;
}): void {
  const { requestedDelta, existingDelta, reason, referenceId } = params;
  if (existingDelta === null) {
    throw new Error(
      `Idempotency validation missing transaction for reason "${reason}" and referenceId "${referenceId}".`
    );
  }
  if (existingDelta !== requestedDelta) {
    throw new Error(
      `Idempotency delta mismatch for reason "${reason}" and referenceId "${referenceId}".`
    );
  }
}

interface CreditServiceDeps {
  getDb: typeof getDb;
}

export const createCreditService = (deps: CreditServiceDeps = { getDb }) => {
  const service = {
    async getCredits(userId: string): Promise<number> {
      const db = await deps.getDb();
      const result = await db
        .select({ total: sql<number>`COALESCE(SUM(${creditTransactions.remainingBalance}), 0)` })
        .from(creditTransactions)
        .where(
          and(
            eq(creditTransactions.userId, userId),
            or(
              isNull(creditTransactions.expiresAt),
              gt(creditTransactions.expiresAt, sql`NOW()`)
            )
          )
        )
        .limit(1);

      const total = result[0]?.total ?? 0;

      await db
        .update(subscriptions)
        .set({ currentCredits: total, updatedAt: new Date() })
        .where(eq(subscriptions.userId, userId));

      return total;
    },

    async spendCredits(userId: string, amount: number, _reason?: string, _referenceId?: string): Promise<boolean> {
      const db = await deps.getDb();
      try {
        return await db.transaction(async (tx: any) => {
          const rows = await tx
            .select({ id: creditTransactions.id, remainingBalance: creditTransactions.remainingBalance })
            .from(creditTransactions)
            .where(
              and(
                eq(creditTransactions.userId, userId),
                gt(creditTransactions.remainingBalance, amount - 1),
                or(
                  isNull(creditTransactions.expiresAt),
                  gt(creditTransactions.expiresAt, sql`NOW()`)
                )
              )
            )
            .orderBy(sql`${creditTransactions.expiresAt} NULLS LAST`)
            .limit(1)
            .for('update');

          if (rows.length === 0) {
            throw new InsufficientCreditsError();
          }

          const row = rows[0];

          await tx
            .update(creditTransactions)
            .set({ remainingBalance: sql`${creditTransactions.remainingBalance} - ${amount}` })
            .where(eq(creditTransactions.id, row.id));

          await tx
            .update(subscriptions)
            .set({
              currentCredits: sql`GREATEST(${subscriptions.currentCredits} - ${amount}, 0)`,
              updatedAt: new Date(),
            })
            .where(eq(subscriptions.userId, userId));

          return true;
        }, { isolationLevel: 'read committed' });
      } catch (error) {
        if (error instanceof InsufficientCreditsError) {
          return false;
        }
        throw error;
      }
    },

    async addCredits(
      userId: string,
      amount: number,
      expiresAt: Date | null,
      transactionType: TransactionType,
      referenceId?: string
    ): Promise<void> {
      const db = await deps.getDb();
      await db.transaction(async (tx: any) => {
        if (referenceId) {
          try {
            await tx.insert(creditTransactions).values({
              userId,
              delta: amount,
              reason: transactionType,
              referenceId,
              initialAmount: amount,
              remainingBalance: amount,
              transactionType,
              expiresAt,
            });
          } catch (error) {
            if (isUniqueViolation(error)) {
              return;
            }
            throw error;
          }
        } else {
          await tx.insert(creditTransactions).values({
            userId,
            delta: amount,
            reason: transactionType,
            initialAmount: amount,
            remainingBalance: amount,
            transactionType,
            expiresAt,
          });
        }

        await tx
          .update(subscriptions)
          .set({
            currentCredits: sql`${subscriptions.currentCredits} + ${amount}`,
            nextExpiryDate: expiresAt
              ? sql`CASE
                  WHEN ${subscriptions.nextExpiryDate} IS NULL OR ${subscriptions.nextExpiryDate} > ${expiresAt}
                  THEN ${expiresAt}
                  ELSE ${subscriptions.nextExpiryDate}
                END`
              : sql`${subscriptions.nextExpiryDate}`,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.userId, userId));
      });
    },

    async refundCredit(userId: string, transactionId: string, amount: number): Promise<void> {
      const db = await deps.getDb();
      await db.transaction(async (tx: any) => {
        await tx
          .update(creditTransactions)
          .set({ remainingBalance: sql`${creditTransactions.remainingBalance} + ${amount}` })
          .where(eq(creditTransactions.id, transactionId));

        await tx
          .update(subscriptions)
          .set({ currentCredits: sql`${subscriptions.currentCredits} + ${amount}`, updatedAt: new Date() })
          .where(eq(subscriptions.userId, userId));
      });
    },

    async renewSubscriptionCredits(
      userId: string,
      amount: number,
      expiresAt: Date,
      referenceId: string
    ): Promise<boolean> {
      const db = await deps.getDb();
      return await db.transaction(async (tx: any) => {
        const existing = await tx
          .select({ id: creditTransactions.id })
          .from(creditTransactions)
          .where(
            and(
              eq(creditTransactions.userId, userId),
              eq(creditTransactions.reason, 'subscription'),
              eq(creditTransactions.referenceId, referenceId)
            )
          )
          .limit(1);

        if (existing.length > 0) {
          return false;
        }

        await tx
          .update(creditTransactions)
          .set({ expiresAt: new Date() })
          .where(
            and(
              eq(creditTransactions.userId, userId),
              eq(creditTransactions.transactionType, 'subscription'),
              or(
                isNull(creditTransactions.expiresAt),
                gt(creditTransactions.expiresAt, sql`NOW()`)
              )
            )
          );

        await tx.insert(creditTransactions).values({
          userId,
          delta: amount,
          reason: 'subscription',
          referenceId,
          initialAmount: amount,
          remainingBalance: amount,
          transactionType: 'subscription',
          expiresAt,
        });

        const totalResult = await tx
          .select({ total: sql<number>`COALESCE(SUM(${creditTransactions.remainingBalance}), 0)` })
          .from(creditTransactions)
          .where(
            and(
              eq(creditTransactions.userId, userId),
              or(
                isNull(creditTransactions.expiresAt),
                gt(creditTransactions.expiresAt, sql`NOW()`)
              )
            )
          );

        const nextExpiryResult = await tx
          .select({ minExpiry: sql<Date | null>`MIN(${creditTransactions.expiresAt})` })
          .from(creditTransactions)
          .where(
            and(
              eq(creditTransactions.userId, userId),
              gt(creditTransactions.remainingBalance, 0),
              gt(creditTransactions.expiresAt, sql`NOW()`)
            )
          );

        await tx
          .update(subscriptions)
          .set({
            currentCredits: totalResult[0]?.total ?? 0,
            nextExpiryDate: nextExpiryResult[0]?.minExpiry ?? null,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.userId, userId));

        return true;
      });
    },

    async adjustCredits(userId: string, delta: number, reason: string, referenceId?: string): Promise<number> {
      const db = await deps.getDb();
      return await db.transaction(async (tx: any) => {
        if (referenceId) {
          try {
            await tx.insert(creditTransactions).values({
              userId,
              delta,
              reason,
              referenceId,
              initialAmount: Math.abs(delta),
              remainingBalance: delta,
              transactionType: 'legacy',
              expiresAt: null,
            });
          } catch (error) {
            if (isUniqueViolation(error)) {
              const existing = await tx
                .select({ delta: creditTransactions.delta })
                .from(creditTransactions)
                .where(
                  and(
                    eq(creditTransactions.userId, userId),
                    eq(creditTransactions.reason, reason),
                    eq(creditTransactions.referenceId, referenceId)
                  )
                )
                .limit(1);

              assertIdempotentDeltaMatch({
                requestedDelta: delta,
                existingDelta: existing[0]?.delta ?? null,
                reason,
                referenceId,
              });

              const current = await tx
                .select({ currentCredits: subscriptions.currentCredits })
                .from(subscriptions)
                .where(eq(subscriptions.userId, userId))
                .limit(1);
              return current[0]?.currentCredits ?? 0;
            }
            throw error;
          }
        } else {
          await tx.insert(creditTransactions).values({
            userId,
            delta,
            reason,
            initialAmount: Math.abs(delta),
            remainingBalance: delta,
            transactionType: 'legacy',
            expiresAt: null,
          });
        }

        const startingCredits = Math.max(0, delta);
        const result = await tx
          .insert(subscriptions)
          .values({ userId, currentCredits: startingCredits })
          .onConflictDoUpdate({
            target: subscriptions.userId,
            set: {
              currentCredits: sql`GREATEST(${subscriptions.currentCredits} + ${delta}, 0)`,
              updatedAt: new Date(),
            },
          })
          .returning({ currentCredits: subscriptions.currentCredits });

        return result[0].currentCredits;
      });
    },
  };

  return service;
};

export const creditService = createCreditService();
