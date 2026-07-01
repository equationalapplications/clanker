import { eq, sql, and, or, isNull, gt, ne, like } from 'drizzle-orm';
import * as logger from 'firebase-functions/logger';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getDb } from '../db/cloudSql.js';
import { subscriptions, creditTransactions } from '../db/schema.js';
import type { TransactionType } from '../db/schema.js';
import type * as schema from '../db/schema.js';

type DbTx = NodePgDatabase<typeof schema>;

export type CreditSpendAllocation = {
  transactionId: string;
  amount: number;
};

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

async function syncSubscriptionCache(tx: DbTx, userId: string): Promise<number> {
  const totalResult = await tx
    .select({ total: sql<number>`GREATEST(COALESCE(SUM(${creditTransactions.remainingBalance}), 0), 0)` })
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

  const total = totalResult[0]?.total ?? 0;
  const nextExpiry = nextExpiryResult[0]?.minExpiry ?? null;

  const existingSubscription = await tx
    .select({ currentCredits: subscriptions.currentCredits, nextExpiryDate: subscriptions.nextExpiryDate })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  const cached = existingSubscription[0] ?? null;
  const expiryMatches =
    (cached?.nextExpiryDate === null && nextExpiry === null) ||
    (cached?.nextExpiryDate instanceof Date && nextExpiry instanceof Date && cached.nextExpiryDate.getTime() === nextExpiry.getTime());

  if (!cached) {
    await tx
      .insert(subscriptions)
      .values({ userId })
      .onConflictDoNothing({ target: subscriptions.userId });
  }

  if (!cached || cached.currentCredits !== total || !expiryMatches) {
    await tx
      .update(subscriptions)
      .set({
        currentCredits: total,
        nextExpiryDate: nextExpiry,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.userId, userId));
  }

  return total;
}

interface CreditServiceDeps {
  getDb: typeof getDb;
}

export const createCreditService = (deps: CreditServiceDeps = { getDb }) => {
  const service = {
    async getCredits(userId: string): Promise<number> {
      const db = await deps.getDb();
      return await db.transaction(async (tx: DbTx) => {
        return syncSubscriptionCache(tx, userId);
      });
    },

    async spendCredits(userId: string, amount: number): Promise<CreditSpendAllocation[] | null> {
      const db = await deps.getDb();
      try {
        return await db.transaction(async (tx: DbTx) => {
          // Ensure a subscriptions row exists and lock it to serialize concurrent spends.
          // Without the row, a SELECT FOR UPDATE returns no rows and no lock is taken.
          await tx
            .insert(subscriptions)
            .values({ userId })
            .onConflictDoNothing({ target: subscriptions.userId });

          await tx
            .select({ userId: subscriptions.userId })
            .from(subscriptions)
            .where(eq(subscriptions.userId, userId))
            .limit(1)
            .for('update');

          // Check net active balance — accounts for negative adjustCredits rows (e.g. Stripe refunds).
          const netResult = await tx
            .select({ total: sql<number>`GREATEST(COALESCE(SUM(${creditTransactions.remainingBalance}), 0), 0)` })
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

          if ((netResult[0]?.total ?? 0) < amount) {
            throw new InsufficientCreditsError();
          }

          const rows = await tx
            .select({ id: creditTransactions.id, remainingBalance: creditTransactions.remainingBalance })
            .from(creditTransactions)
            .where(
              and(
                eq(creditTransactions.userId, userId),
                gt(creditTransactions.remainingBalance, 0),
                or(
                  isNull(creditTransactions.expiresAt),
                  gt(creditTransactions.expiresAt, sql`NOW()`)
                )
              )
            )
            .orderBy(sql`${creditTransactions.expiresAt} NULLS LAST`, creditTransactions.id)
            .for('update');

          let remaining = amount;
          const allocations: CreditSpendAllocation[] = [];
          for (const row of rows) {
            if (remaining <= 0) break;
            const take = Math.min(Number(row.remainingBalance), remaining);
            await tx
              .update(creditTransactions)
              .set({ remainingBalance: sql`${creditTransactions.remainingBalance} - ${take}` })
              .where(eq(creditTransactions.id, row.id));
            allocations.push({ transactionId: row.id, amount: take });
            remaining -= take;
          }

          if (remaining > 0 || allocations.length === 0) {
            // Net balance passed under lock but rows could not cover it — should be unreachable.
            logger.warn('spendCredits: net balance sufficient but rows could not cover amount', { userId, amount, net: netResult[0]?.total });
            throw new InsufficientCreditsError();
          }

          await syncSubscriptionCache(tx, userId);

          return allocations;
        }, { isolationLevel: 'read committed' });
      } catch (error) {
        if (error instanceof InsufficientCreditsError) {
          return null;
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
      await db.transaction(async (tx: DbTx) => {
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
              const existing = await tx
                .select({ delta: creditTransactions.delta })
                .from(creditTransactions)
                .where(
                  and(
                    eq(creditTransactions.userId, userId),
                    eq(creditTransactions.reason, transactionType),
                    eq(creditTransactions.referenceId, referenceId)
                  )
                )
                .limit(1);

              assertIdempotentDeltaMatch({
                requestedDelta: amount,
                existingDelta: existing[0]?.delta ?? null,
                reason: transactionType,
                referenceId,
              });

              await syncSubscriptionCache(tx, userId);
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

        await syncSubscriptionCache(tx, userId);
      });
    },

    async setCredits(userId: string, amount: number, reason: string, referenceId: string): Promise<void> {
      const db = await deps.getDb();
      await db.transaction(async (tx: DbTx) => {
        // Serialize against concurrent setCredits and spendCredits calls for this user.
        await tx
          .insert(subscriptions)
          .values({ userId })
          .onConflictDoNothing({ target: subscriptions.userId });

        await tx
          .select({ userId: subscriptions.userId })
          .from(subscriptions)
          .where(eq(subscriptions.userId, userId))
          .limit(1)
          .for('update');

        const inserted = await tx
          .insert(creditTransactions)
          .values({
            userId,
            delta: amount,
            reason,
            referenceId,
            initialAmount: amount,
            remainingBalance: amount,
            transactionType: 'legacy',
            expiresAt: null,
          })
          .onConflictDoNothing()
          .returning({ id: creditTransactions.id });

        if (inserted.length === 0) {
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
            requestedDelta: amount,
            existingDelta: existing[0]?.delta ?? null,
            reason,
            referenceId,
          });

          await syncSubscriptionCache(tx, userId);
          return;
        }

        await tx
          .update(creditTransactions)
          .set({ expiresAt: sql`NOW()` })
          .where(
            and(
              eq(creditTransactions.userId, userId),
              or(isNull(creditTransactions.expiresAt), gt(creditTransactions.expiresAt, sql`NOW()`)),
              ne(creditTransactions.id, inserted[0].id)
            )
          );

        await syncSubscriptionCache(tx, userId);
      });
    },

    async refundCredit(userId: string, allocations: CreditSpendAllocation[]): Promise<void> {
      if (allocations.length === 0) {
        return;
      }

      const db = await deps.getDb();
      await db.transaction(async (tx: DbTx) => {
        for (const { transactionId, amount } of allocations) {
          // Single atomic UPDATE: expiry guard lives in the WHERE clause so the
          // SELECT-then-UPDATE race (a concurrent renewal expiring the row between the two ops) cannot occur.
          const updated = await tx
            .update(creditTransactions)
            .set({ remainingBalance: sql`${creditTransactions.remainingBalance} + ${amount}` })
            .where(
              and(
                eq(creditTransactions.id, transactionId),
                eq(creditTransactions.userId, userId),
                or(
                  isNull(creditTransactions.expiresAt),
                  gt(creditTransactions.expiresAt, sql`NOW()`)
                )
              )
            )
            .returning({ id: creditTransactions.id });

          if (updated.length === 0) {
            // Original row expired between spend and refund (e.g. subscription renewal expired the pool).
            // Insert a non-expiring compensation so credits remain accessible to the user.
            await tx.insert(creditTransactions).values({
              userId,
              delta: amount,
              reason: 'refund_compensation',
              initialAmount: amount,
              remainingBalance: amount,
              transactionType: 'legacy',
              expiresAt: null,
            });
          }
        }

        await syncSubscriptionCache(tx, userId);
      });
    },

    async renewSubscriptionCredits(
      userId: string,
      amount: number,
      expiresAt: Date,
      referenceId: string
    ): Promise<boolean> {
      const db = await deps.getDb();
      return await db.transaction(async (tx: DbTx) => {
        // Insert first — this is the atomic idempotency guard (spec: check before any writes).
        const inserted = await tx
          .insert(creditTransactions)
          .values({
            userId,
            delta: amount,
            reason: 'subscription',
            referenceId,
            initialAmount: amount,
            remainingBalance: amount,
            transactionType: 'subscription',
            expiresAt,
          })
          .onConflictDoNothing()
          .returning({ id: creditTransactions.id });

        if (inserted.length === 0) {
          return false;
        }

        // Expire previous subscription credits using DB clock, excluding the row just inserted.
        await tx
          .update(creditTransactions)
          .set({ expiresAt: sql`NOW()` })
          .where(
            and(
              eq(creditTransactions.userId, userId),
              eq(creditTransactions.transactionType, 'subscription'),
              gt(creditTransactions.expiresAt, sql`NOW()`),
              ne(creditTransactions.id, inserted[0].id)
            )
          );

        await syncSubscriptionCache(tx, userId);
        return true;
      });
    },

    async getLastProcessedChargeRefundTotal(chargeId: string): Promise<number> {
      const db = await deps.getDb();
      const prefix = `${chargeId}_`;
      const rows = await db
        .select({ referenceId: creditTransactions.referenceId })
        .from(creditTransactions)
        .where(
          and(
            eq(creditTransactions.reason, 'stripe_refund'),
            like(creditTransactions.referenceId, `${chargeId}_%`)
          )
        );

      let maxRefunded = 0;
      for (const row of rows) {
        if (!row.referenceId?.startsWith(prefix)) {
          continue;
        }
        const refundedAmount = Number(row.referenceId.slice(prefix.length));
        if (Number.isFinite(refundedAmount) && refundedAmount > maxRefunded) {
          maxRefunded = refundedAmount;
        }
      }
      return maxRefunded;
    },

    async adjustCredits(userId: string, delta: number, reason: string, referenceId?: string): Promise<number> {
      const db = await deps.getDb();
      return await db.transaction(async (tx: DbTx) => {
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

              return syncSubscriptionCache(tx, userId);
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

        // Ensure subscription row exists for new users, then sync both currentCredits and nextExpiryDate.
        const startingCredits = Math.max(0, delta);
        await tx
          .insert(subscriptions)
          .values({ userId, currentCredits: startingCredits })
          .onConflictDoNothing({ target: subscriptions.userId });

        return syncSubscriptionCache(tx, userId);
      });
    },
  };

  return service;
};

export const creditService = createCreditService();
