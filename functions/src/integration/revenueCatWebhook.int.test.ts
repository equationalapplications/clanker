/**
 * RevenueCat webhook integration suite (R1–R8).
 *
 * Authenticated deliveries over real HTTP against the real clanker_test
 * Postgres; the REAL subscription/credit/user services run underneath. Only
 * the GA4 senders are fake (recording no-ops), and Firebase Auth is never
 * touched: normal rows resolve through the real findUserByFirebaseUid, and R8
 * relies on getOrCreateUserByFirebaseUid being OMITTED to prove the 503 path.
 */
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { revenueCatWebhookHandler } from '../revenueCatWebhook.js'
import { createSubscriptionService } from '../services/subscriptionService.js'
import { createCreditService } from '../services/creditService.js'
import { userRepository } from '../services/userRepository.js'
import {
  ensureIntegrationDatabase,
  testGetDb,
  seedUser,
  truncateAll,
  expectNoPaymentWrites,
  closeIntegrationPool,
  getPool,
} from './helpers/db.js'
import { rcAuthHeaders } from './helpers/signing.js'
import { startWebhookServer } from './helpers/httpHarness.js'

// Lazy-read env — safe despite ESM hoisting (the handler reads the secret per request).
// REVENUECAT_WEBHOOK_SECRET is PINNED to this literal (not the signing constant) so
// the wrong-signer red-provability drill only breaks the SIGNER side of
// helpers/signing.ts.
process.env.REVENUECAT_WEBHOOK_SECRET = 'rc_int_secret_123' // == INT_RC_SECRET in helpers/signing.ts

before(async () => {
  await ensureIntegrationDatabase()
})
beforeEach(async () => {
  await truncateAll()
})
after(async () => {
  await closeIntegrationPool()
})

// Deterministic expiration timestamp: renewal-grant key component + billing cycle end.
const EXP_MS = Date.UTC(2027, 0, 1)

// Distinct synthetic emails — users.email carries a UNIQUE constraint, so every
// seeded user gets its own address. RC resolves users by app_user_id → firebase_uid
// lookup, not email; emails here are seed data only (distinctness still matters).
const synthEmail = (tag: string): string => `${tag}@test.local`

// Hung-run guard: EVERY test in this file is declared as
//   test('<name>', { timeout: 10_000 }, async () => { ... })

// REAL service instances over clanker_test — identical wiring to defaultDeps,
// except the GA4 senders, which are recording no-ops, and getOrCreateUserByFirebaseUid,
// which is deliberately omitted everywhere (never touches Firebase Auth; R8 depends
// on that omission). testGetDb hands services the same runtime drizzle instance
// cloudSql.getDb would; their static types differ only by drizzle's `$client` brand,
// so bridge it once here.
type ServicesGetDb = NonNullable<Parameters<typeof createSubscriptionService>[0]>['getDb']
const servicesGetDb = testGetDb as ServicesGetDb
const subsService = createSubscriptionService({ getDb: servicesGetDb })
const credits = createCreditService({ getDb: servicesGetDb })

const makeRcDeps = () => {
  const purchaseCalls: Array<Record<string, unknown>> = []
  const deps = {
    // REAL lookup against clanker_test (mirrors defaultDeps :112-116).
    findUserByFirebaseUid: async (uid: string) => {
      const u = await userRepository.findUserByFirebaseUid(uid, { getDb: servicesGetDb })
      return u ? { id: u.id } : null
    },
    // getOrCreateUserByFirebaseUid intentionally omitted — never touches Firebase Auth.
    getSubscription: async (userId: string) => {
      const s = await subsService.getSubscription(userId)
      return s
        ? {
            planTier: s.planTier,
            planStatus: s.planStatus,
            subscriptionProvider: s.subscriptionProvider,
          }
        : null
    },
    // Mirrors defaultDeps :148-157 (renewalAt → billingCycleEnd).
    upsertSubscription: async (p: {
      userId: string
      planTier: 'free' | 'monthly_20' | 'monthly_50' | 'payg'
      planStatus: 'active' | 'cancelled' | 'expired'
      renewalAt?: Date | null
      subscriptionProvider?: 'stripe' | 'revenuecat' | null
      cancelAtPeriodEnd?: boolean
    }) =>
      subsService.upsertSubscription({
        userId: p.userId,
        planTier: p.planTier,
        planStatus: p.planStatus,
        billingCycleEnd: p.renewalAt ?? null,
        subscriptionProvider: p.subscriptionProvider ?? null,
        cancelAtPeriodEnd: p.cancelAtPeriodEnd,
      }),
    renewSubscriptionCredits: (id: string, amount: number, e: Date, r: string) =>
      credits.renewSubscriptionCredits(id, amount, e, r),
    addCredits: (
      id: string,
      amount: number,
      e: Date | null,
      t: 'one_time' | 'signup' | 'legacy',
      r?: string,
    ) => credits.addCredits(id, amount, e, t, r),
    adjustCredits: (id: string, delta: number, reason: string, r?: string) =>
      credits.adjustCredits(id, delta, reason, r),
    sendPurchaseEvent: async (p: Record<string, unknown>) => {
      purchaseCalls.push(p)
    },
    sendRefundEvent: async () => {},
  }
  return { deps, purchaseCalls }
}

const rcEvent = (fields: Record<string, unknown>) => ({
  event: { app_user_id: 'uid_rc', product_id: 'monthly_20_subscription', ...fields },
})

const mountAndPostRc = async (
  deps: unknown,
  body: Record<string, unknown>,
  form: 'bearer' | 'bare' = 'bearer',
) => {
  const server = await startWebhookServer((req, res) =>
    revenueCatWebhookHandler(req as never, res as never, deps as never),
  )
  try {
    const response = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...rcAuthHeaders(form) },
      body: JSON.stringify(body),
    })
    return { status: response.status, text: await response.text() }
  } finally {
    await server.close()
  }
}


test(
  'R1: bearer-authenticated INITIAL_PURCHASE upserts revenuecat sub + grants renewal credits',
  { timeout: 10_000 },
  async () => {
    const user = await seedUser('uid_rc_r1', synthEmail('rc-r1'))
    const { deps, purchaseCalls } = makeRcDeps()

    const { status, text } = await mountAndPostRc(
      deps,
      rcEvent({
        type: 'INITIAL_PURCHASE',
        app_user_id: 'uid_rc_r1',
        expiration_at_ms: EXP_MS,
        original_transaction_id: 'rc_r1_txn',
        // Real RC purchase payloads always carry price + currency; without them
        // emitRevenueCatPurchase skips GA4 entirely (revenueCatWebhook.ts:226 guard).
        price_in_purchased_currency: 19.99,
        currency: 'usd',
      }),
    )

    assert.equal(status, 200)
    assert.deepEqual(JSON.parse(text), { received: true })

    const sub = await getPool().query(
      `SELECT plan_tier, plan_status, subscription_provider, cancel_at_period_end, billing_cycle_end
       FROM subscriptions WHERE user_id = $1`,
      [user.id],
    )
    assert.equal(sub.rows[0].plan_tier, 'monthly_20')
    assert.equal(sub.rows[0].plan_status, 'active')
    assert.equal(sub.rows[0].subscription_provider, 'revenuecat')
    assert.equal(sub.rows[0].cancel_at_period_end, false)
    assert.equal(new Date(sub.rows[0].billing_cycle_end).getTime(), EXP_MS)

    const grant = await getPool().query(
      `SELECT delta, reason, transaction_type, reference_id FROM credit_transactions
       WHERE user_id = $1 AND reference_id = $2`,
      [user.id, `rc_r1_txn_${EXP_MS}`],
    )
    assert.equal(grant.rowCount, 1)
    assert.equal(grant.rows[0].delta, 30000)
    assert.equal(grant.rows[0].reason, 'subscription')

    assert.equal(purchaseCalls.length, 1)
    assert.equal(purchaseCalls[0].paymentProvider, 'revenuecat')
    assert.equal(purchaseCalls[0].transactionId, `rc_r1_txn_${EXP_MS}`) // resolveGa4TransactionId fallback
  },
)

test(
  'R2: wrong bearer is rejected 401 with zero DB writes (red-provable)',
  { timeout: 10_000 },
  async () => {
    const server = await startWebhookServer((req, res) =>
      revenueCatWebhookHandler(req as never, res as never, makeRcDeps().deps as never),
    )
    try {
      const response = await fetch(server.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer wrong-secret' },
        body: JSON.stringify(rcEvent({ type: 'INITIAL_PURCHASE' })),
      })
      assert.equal(response.status, 401)
      assert.equal(await response.text(), 'Unauthorized')
    } finally {
      await server.close()
    }
    await expectNoPaymentWrites()
  },
)

test('R3: bare-secret authorization form is accepted', { timeout: 10_000 }, async () => {
  await seedUser('uid_rc_r3', synthEmail('rc-r3'))
  const { deps } = makeRcDeps()
  const { status } = await mountAndPostRc(
    deps,
    rcEvent({
      type: 'INITIAL_PURCHASE',
      app_user_id: 'uid_rc_r3',
      expiration_at_ms: EXP_MS,
      original_transaction_id: 'rc_r3_txn',
    }),
    'bare',
  )
  assert.equal(status, 200)
})

test(
  'R4: SANDBOX events ack with ignored:sandbox and persist nothing',
  { timeout: 10_000 },
  async () => {
    const { deps } = makeRcDeps()
    const { status, text } = await mountAndPostRc(
      deps,
      rcEvent({ type: 'INITIAL_PURCHASE', environment: 'SANDBOX' }),
    )
    assert.equal(status, 200)
    assert.deepEqual(JSON.parse(text), { received: true, ignored: 'sandbox' })
    await expectNoPaymentWrites()
  },
)

test('R5: TEST-type events are acknowledged and persist nothing', { timeout: 10_000 }, async () => {
  const { deps } = makeRcDeps()
  // rcEvent supplies app_user_id/product_id: parseRevenueCatEvent requires BOTH
  // before the TEST short-circuit is reached (revenueCatWebhook.ts:374-384, :553).
  const { status, text } = await mountAndPostRc(deps, rcEvent({ type: 'TEST' }))
  assert.equal(status, 200)
  assert.deepEqual(JSON.parse(text), { received: true })
  await expectNoPaymentWrites()
})

test(
  'R6: active stripe collision warns-and-proceeds: row moves to revenuecat, credits granted',
  { timeout: 10_000 },
  async () => {
    const user = await seedUser('uid_rc_r6', synthEmail('rc-r6'))
    // Seed an active STRIPE subscription directly (upsert-safe whether or not the
    // handle_new_user trigger already created a free row).
    await subsService.upsertSubscription({
      userId: user.id,
      planTier: 'monthly_50',
      planStatus: 'active',
      subscriptionProvider: 'stripe',
    })
    const { deps } = makeRcDeps()

    const { status } = await mountAndPostRc(
      deps,
      rcEvent({
        type: 'INITIAL_PURCHASE',
        app_user_id: 'uid_rc_r6',
        expiration_at_ms: EXP_MS,
        original_transaction_id: 'rc_r6_txn',
      }),
    )
    assert.equal(status, 200)

    const sub = await getPool().query(
      `SELECT plan_tier, plan_status, subscription_provider FROM subscriptions WHERE user_id = $1`,
      [user.id],
    )
    assert.equal(sub.rows[0].subscription_provider, 'revenuecat') // defined outcome
    assert.equal(sub.rows[0].plan_tier, 'monthly_20')

    const grant = await getPool().query(
      `SELECT 1 FROM credit_transactions WHERE user_id = $1 AND reference_id = $2`,
      [user.id, `rc_r6_txn_${EXP_MS}`],
    )
    assert.equal(grant.rowCount, 1)
  },
)

test(
  'R7: Android product id suffix is stripped before tier mapping',
  { timeout: 10_000 },
  async () => {
    const user = await seedUser('uid_rc_r7', synthEmail('rc-r7'))
    const { deps } = makeRcDeps()

    const { status } = await mountAndPostRc(
      deps,
      rcEvent({
        type: 'INITIAL_PURCHASE',
        app_user_id: 'uid_rc_r7',
        product_id: 'monthly_20_subscription:some-base-plan', // Android form
        expiration_at_ms: EXP_MS,
        original_transaction_id: 'rc_r7_txn',
      }),
    )
    assert.equal(status, 200)

    const sub = await getPool().query(
      `SELECT plan_tier, subscription_provider FROM subscriptions WHERE user_id = $1`,
      [user.id],
    )
    assert.equal(sub.rows[0].plan_tier, 'monthly_20') // normalized, suffix gone
    assert.equal(sub.rows[0].subscription_provider, 'revenuecat')
  },
)

test(
  'R8: unknown user with no bootstrap dep resolves 503 and creates no orphan rows',
  { timeout: 10_000 },
  async () => {
    const { deps } = makeRcDeps() // findUserByFirebaseUid → real lookup → null; no getOrCreate provided
    const { status, text } = await mountAndPostRc(
      deps,
      rcEvent({
        type: 'INITIAL_PURCHASE',
        app_user_id: 'uid_nobody',
        expiration_at_ms: EXP_MS,
        original_transaction_id: 'rc_r8_txn',
      }),
    )
    assert.equal(status, 503)
    assert.deepEqual(JSON.parse(text), { received: false, error: 'Cloud SQL user not ready' })

    const users = await getPool().query('SELECT 1 FROM users')
    assert.equal(users.rowCount, 0)
    await expectNoPaymentWrites()
  },
)
