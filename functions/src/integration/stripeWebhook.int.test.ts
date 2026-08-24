/**
 * Stripe webhook integration suite (S1–S6, D1–D4).
 *
 * Genuinely-signed deliveries over real HTTP against the real clanker_test
 * Postgres; the REAL subscription/credit/dedupe/user services run underneath.
 * Only two things are fake: the Stripe REST client (post-verification reads)
 * and the GA4 senders (recording no-ops).
 */
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Stripe from 'stripe'
import { stripeWebhookHandler, setStripeClientFactoryForTests } from '../stripeWebhook.js'
import { createSubscriptionService } from '../services/subscriptionService.js'
import { createCreditService } from '../services/creditService.js'
import { createStripeEventDedupeService } from '../services/stripeEventDedupeService.js'
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
import {
  INT_STRIPE_SECRET,
  INT_PRICE_IDS,
  signedStripePost,
  signStripeHeader,
} from './helpers/signing.js'
import { startWebhookServer } from './helpers/httpHarness.js'

// Lazy-read env — safe despite ESM hoisting (handlers read secrets/prices per request).
// STRIPE_WEBHOOK_SECRET is pinned to the OLD literal (not the signing constant)
// so the wrong-signer red-provability drill only breaks the SIGNER side.
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_int_test_123' // == INT_STRIPE_SECRET in helpers/signing.ts
// Negative tests (S3–S5) have no client factory, so the handler builds a real
// SDK client from STRIPE_SECRET_KEY before verifying signatures. Without this
// they would bail earlier with 500 ("Stripe configuration error") and never
// reach the genuine constructEvent path the suite exists to exercise.
process.env.STRIPE_SECRET_KEY = 'sk_test_integration_placeholder'
process.env.STRIPE_MONTHLY_20_PRICE_ID = INT_PRICE_IDS.monthly20
process.env.STRIPE_MONTHLY_50_PRICE_ID = INT_PRICE_IDS.monthly50
process.env.STRIPE_CREDIT_PACK_PRICE_ID = INT_PRICE_IDS.creditPack

before(async () => {
  await ensureIntegrationDatabase()
})
beforeEach(async () => {
  await truncateAll()
})
after(async () => {
  await closeIntegrationPool()
})

// Deterministic timestamp: subscription period end for renewal-grant keys.
const PERIOD_END_SECS = Math.floor(Date.UTC(2027, 0, 1) / 1000)

// Distinct synthetic emails — users.email carries a UNIQUE constraint, so every
// seeded user gets its own address. Within any single test the seeded user and
// the event fixture MUST share one binding (handler resolves users by email).
const synthEmail = (tag: string): string => `${tag}@int.test`

// Hung-run guard: EVERY test in this file is declared as
//   test('<name>', { timeout: 10_000 }, async () => { ... })

// REAL service instances over clanker_test — identical wiring to each file's
// defaultDeps, except the GA4 senders, which are recording no-ops.
// testGetDb hands services the same runtime drizzle instance cloudSql.getDb
// would; their static types differ only by drizzle's `$client` brand (two
// different `drizzle()` overload instantiations), so bridge it once here.
type ServicesGetDb = NonNullable<Parameters<typeof createSubscriptionService>[0]>['getDb']
const servicesGetDb = testGetDb as ServicesGetDb
const subsService = createSubscriptionService({ getDb: servicesGetDb })
const credits = createCreditService({ getDb: servicesGetDb })
const dedupe = createStripeEventDedupeService({ getDb: servicesGetDb })

interface Ga4Recorder<T> {
  calls: T[]
}
const recorder = <T>(): Ga4Recorder<T> & ((p: T) => Promise<void>) => {
  const r: { calls: T[] } = { calls: [] }
  const fn = async (p: T) => {
    r.calls.push(p)
  }
  return Object.assign(fn, r) as Ga4Recorder<T> & ((p: T) => Promise<void>)
}

const makeRealStripeDeps = () => {
  const purchase = recorder<Record<string, unknown>>()
  const refund = recorder<Record<string, unknown>>()
  const deps = {
    findUserByEmail: async (email: string) => {
      const u = await userRepository.findUserByEmail(email, { getDb: servicesGetDb })
      return u ? { id: u.id, email: u.email, firebaseUid: u.firebaseUid ?? undefined } : null
    },
    findUserByFirebaseUid: async (uid: string) => {
      const u = await userRepository.findUserByFirebaseUid(uid, { getDb: servicesGetDb })
      return u ? { id: u.id, email: u.email, firebaseUid: u.firebaseUid ?? undefined } : null
    },
    findUserByStripeCustomerId: async (customerId: string) => {
      const userId = await subsService.findUserIdByStripeCustomerId(customerId)
      if (!userId) return null
      const u = await userRepository.findUserById(userId, { getDb: servicesGetDb })
      return u ? { id: u.id, email: u.email, firebaseUid: u.firebaseUid ?? undefined } : null
    },
    upsertSubscription: (p: Parameters<typeof subsService.upsertSubscription>[0]) =>
      subsService.upsertSubscription(p),
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
    sendPurchaseEvent: purchase,
    sendRefundEvent: refund,
    isEventProcessed: (eventId: string) => dedupe.isEventProcessed(eventId),
    markEventProcessed: (eventId: string) => dedupe.markEventProcessed(eventId),
    completeEventProcessed: (eventId: string) => dedupe.completeEventProcessed(eventId),
    unmarkEventProcessed: (eventId: string) => dedupe.unmarkEventProcessed(eventId),
    expireProcessingClaim: (eventId: string) => dedupe.expireProcessingClaim(eventId),
    getLastProcessedChargeRefundTotal: (chargeId: string) =>
      credits.getLastProcessedChargeRefundTotal(chargeId),
  }
  return { deps, purchase, refund }
}

/**
 * Stripe test double answering only the four post-verification REST reads.
 * Built on a REAL SDK instance: the handler runs webhooks.constructEvent on
 * whatever client the factory returns, so signature verification must stay
 * genuinely real — only checkout/subscriptions/customers/invoices are faked
 * (same pattern as stripeWebhook.test.ts).
 */
const makeFakeStripe = (overrides: {
  lineItems?: unknown[]
  subscription?: Record<string, unknown>
  invoice?: Record<string, unknown>
}): Stripe => {
  const client = new Stripe('sk_test_123')
  const fakeRest = {
    checkout: {
      sessions: {
        listLineItems: async () => ({
          data: overrides.lineItems ?? [
            { price: { id: INT_PRICE_IDS.monthly20 }, quantity: 1, amount_total: 20000 },
          ],
        }),
      },
    },
    subscriptions: {
      retrieve: async () =>
        overrides.subscription ?? { deleted: false, current_period_end: PERIOD_END_SECS },
    },
    customers: { retrieve: async () => ({ id: 'cus_int', metadata: {} }) },
    invoices: { retrieve: async () => overrides.invoice ?? { lines: { data: [] } } },
  }
  return Object.assign(client, fakeRest) as unknown as Stripe
}

const postStripeEvent = async (url: string, event: Record<string, unknown>) => {
  const response = await fetch(url, signedStripePost(JSON.stringify(event)))
  return { status: response.status, text: await response.text() }
}

const mountAndPost = async (deps: unknown, event: Record<string, unknown>) => {
  const server = await startWebhookServer((req, res) =>
    stripeWebhookHandler(req as never, res as never, deps as never),
  )
  try {
    return await postStripeEvent(server.url, event)
  } finally {
    await server.close()
  }
}

// Predicate-scoped assertion helpers (DB trigger auto-seeds a signup grant +
// a free subscriptions row per user — never assert absolute counts).
const countCreditRows = async (whereSql: string, params: unknown[] = []) => {
  const { rowCount } = await getPool().query(
    `SELECT 1 FROM credit_transactions WHERE ${whereSql}`,
    params,
  )
  return rowCount ?? 0
}

const DAY_MS = 24 * 60 * 60 * 1000

test(
  'S1: signed checkout.session.completed grants renewal credits and upserts the subscription',
  { timeout: 10_000 },
  async () => {
    const email = synthEmail('stripe-s1')
    const user = await seedUser('uid_stripe_s1', email)
    const { deps, purchase } = makeRealStripeDeps()
    setStripeClientFactoryForTests(() =>
      makeFakeStripe({
        lineItems: [{ price: { id: INT_PRICE_IDS.monthly20 }, quantity: 1, amount_total: 20000 }],
      }),
    )

    const event = {
      id: 'evt_s1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_s1',
          customer_details: { email },
          customer_email: email,
          client_reference_id: null,
          subscription: 'sub_s1',
          customer: 'cus_s1',
          amount_total: 20000,
          currency: 'usd',
        },
      },
    }

    try {
      const { status, text } = await mountAndPost(deps, event)
      assert.equal(status, 200)
      assert.deepEqual(JSON.parse(text), { received: true })

      const sub = await getPool().query(
        `SELECT plan_tier, plan_status, subscription_provider, stripe_subscription_id, stripe_customer_id, cancel_at_period_end
       FROM subscriptions WHERE user_id = $1`,
        [user.id],
      )
      assert.equal(sub.rows[0].plan_tier, 'monthly_20')
      assert.equal(sub.rows[0].plan_status, 'active')
      assert.equal(sub.rows[0].subscription_provider, 'stripe')
      assert.equal(sub.rows[0].stripe_subscription_id, 'sub_s1')
      assert.equal(sub.rows[0].stripe_customer_id, 'cus_s1')
      assert.equal(sub.rows[0].cancel_at_period_end, false)

      // Renewal grant: SUBSCRIPTION_RENEWAL_CREDIT_AMOUNT keyed by sub_<id>_<periodEnd>.
      const grants = await getPool().query(
        `SELECT delta, reason, transaction_type, reference_id FROM credit_transactions
       WHERE user_id = $1 AND reference_id = $2`,
        [user.id, `sub_sub_s1_${PERIOD_END_SECS}`],
      )
      assert.equal(grants.rowCount, 1)
      assert.equal(grants.rows[0].delta, 30000)
      assert.equal(grants.rows[0].reason, 'subscription')
      assert.equal(grants.rows[0].transaction_type, 'subscription')

      const processed = await getPool().query(
        `SELECT status FROM processed_stripe_events WHERE event_id = 'evt_s1'`,
      )
      assert.equal(processed.rows[0].status, 'completed')

      // GA4 purchase events fire ONLY for credit-pack line items
      // (handleCheckoutCompleted pack branch). A subscription-only cart emits NONE.
      assert.equal(purchase.calls.length, 0)
    } finally {
      setStripeClientFactoryForTests(null)
    }
  },
)

test(
  'S1 pack-only: signed checkout.session.completed grants one_time credits x quantity and emits exactly one GA4 purchase',
  { timeout: 10_000 },
  async () => {
    const email = synthEmail('stripe-s1p')
    const user = await seedUser('uid_stripe_s1p', email)
    const { deps, purchase } = makeRealStripeDeps()
    setStripeClientFactoryForTests(() =>
      makeFakeStripe({
        lineItems: [{ price: { id: INT_PRICE_IDS.creditPack }, quantity: 2, amount_total: 4000 }],
      }),
    )

    const t0 = Date.now()
    const event = {
      id: 'evt_s1_pack',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_pack',
          customer_details: { email },
          customer_email: email,
          client_reference_id: null,
          subscription: null,
          customer: 'cus_s1pack',
          amount_total: 4000,
          currency: 'usd',
        },
      },
    }

    try {
      const { status, text } = await mountAndPost(deps, event)
      assert.equal(status, 200)
      assert.deepEqual(JSON.parse(text), { received: true })

      const grants = await getPool().query(
        `SELECT delta, reason, transaction_type, reference_id, expires_at FROM credit_transactions
       WHERE user_id = $1 AND reference_id = $2`,
        [user.id, 'cs_pack'],
      )
      assert.equal(grants.rowCount, 1)
      assert.equal(grants.rows[0].delta, 20000) // CREDIT_PACK_AMOUNT (10000) x qty 2
      assert.equal(grants.rows[0].reason, 'one_time')
      assert.equal(grants.rows[0].transaction_type, 'one_time')
      assert.equal(grants.rows[0].reference_id, 'cs_pack')

      // Pack expiry is now + 31d; tolerance avoids flakes.
      const expiresAtMs = new Date(grants.rows[0].expires_at).getTime()
      assert.ok(
        expiresAtMs >= t0 + 30 * DAY_MS,
        `expected expiry >= now+30d, got ${grants.rows[0].expires_at}`,
      )
      assert.ok(
        expiresAtMs <= t0 + 32 * DAY_MS,
        `expected expiry <= now+32d, got ${grants.rows[0].expires_at}`,
      )

      // Exactly one GA4 purchase, pinned to the verified emission shape.
      assert.equal(purchase.calls.length, 1)
      assert.deepEqual(purchase.calls[0], {
        firebaseUid: user.firebaseUid,
        transactionId: 'cs_pack',
        valueMinorUnits: 4000, // pack subtotal only, even in mixed carts
        currency: 'usd',
        paymentProvider: 'stripe',
      })
    } finally {
      setStripeClientFactoryForTests(null)
    }
  },
)

test(
  'S2: replaying the same event id writes exactly one credit grant',
  { timeout: 10_000 },
  async () => {
    const email = synthEmail('stripe-s2')
    const user = await seedUser('uid_stripe_s2', email)
    const { deps } = makeRealStripeDeps()
    setStripeClientFactoryForTests(() => makeFakeStripe({}))

    const event = {
      id: 'evt_s2',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_s2',
          customer_details: { email },
          customer_email: null,
          client_reference_id: null,
          subscription: 'sub_s2',
          customer: 'cus_s2',
          amount_total: 20000,
          currency: 'usd',
        },
      },
    }

    try {
      const first = await mountAndPost(deps, event)
      assert.equal(first.status, 200)
      const second = await mountAndPost(deps, event) // fresh genuine signature, same bytes+id
      assert.equal(second.status, 200)
      assert.deepEqual(JSON.parse(second.text), { received: true }) // markEventProcessed short-circuit

      assert.equal(
        await countCreditRows("user_id = $1 AND transaction_type = 'subscription'", [user.id]),
        1,
      )
      const processed = await getPool().query(
        `SELECT count(*)::int AS n FROM processed_stripe_events WHERE event_id = 'evt_s2'`,
      )
      assert.equal(processed.rows[0].n, 1)
    } finally {
      setStripeClientFactoryForTests(null)
    }
  },
)

test(
  'S3: valid signature over tampered bytes is rejected with no writes',
  { timeout: 10_000 },
  async () => {
    const original = JSON.stringify({
      id: 'evt_s3',
      type: 'checkout.session.completed',
      data: { object: {} },
    })
    const signed = signedStripePost(original)
    const tamperedBytes = original.replace('checkout.session.completed', 'charge.refunded')
    const server = await startWebhookServer((req, res) =>
      stripeWebhookHandler(req as never, res as never, makeRealStripeDeps().deps as never),
    )
    try {
      const response = await fetch(server.url, {
        method: 'POST',
        headers: signed.headers,
        body: tamperedBytes,
      })
      assert.equal(response.status, 400)
    } finally {
      await server.close()
    }
    await expectNoPaymentWrites()
  },
)

test(
  'S4: missing and garbage signature headers are rejected with no writes',
  { timeout: 10_000 },
  async () => {
    const body = JSON.stringify({ id: 'evt_s4', type: 'unhandled.event', data: { object: {} } })
    const server = await startWebhookServer((req, res) =>
      stripeWebhookHandler(req as never, res as never, makeRealStripeDeps().deps as never),
    )
    try {
      const missing = await fetch(server.url, { method: 'POST', body })
      assert.equal(missing.status, 400)
      const garbage = await fetch(server.url, {
        method: 'POST',
        headers: { 'stripe-signature': 'v1=deadbeef,t=1' },
        body,
      })
      assert.equal(garbage.status, 400)
    } finally {
      await server.close()
    }
    await expectNoPaymentWrites()
  },
)

test(
  'S5: well-signed malformed JSON yields a defined 4xx, no partial writes',
  { timeout: 10_000 },
  async () => {
    const broken = '{"id":"evt_s5","type":"unhandled.event",' // truncated JSON
    const server = await startWebhookServer((req, res) =>
      stripeWebhookHandler(req as never, res as never, makeRealStripeDeps().deps as never),
    )
    try {
      const response = await fetch(server.url, {
        method: 'POST',
        headers: { 'stripe-signature': signStripeHeader(broken, INT_STRIPE_SECRET) },
        body: broken,
      })
      assert.ok(response.status >= 400 && response.status < 500)
    } finally {
      await server.close()
    }
    await expectNoPaymentWrites()
  },
)

test(
  'S6a: partial pack refund deducts floor-proportional credits once',
  { timeout: 10_000 },
  async () => {
    const email = synthEmail('stripe-s6a')
    const user = await seedUser('uid_stripe_s6', email)
    const { deps, refund } = makeRealStripeDeps()
    setStripeClientFactoryForTests(() => makeFakeStripe({}))

    const chargeEvent = (amountRefunded: number, eventId: string) => ({
      id: eventId,
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_s6',
          amount: 2000,
          amount_refunded: amountRefunded,
          currency: 'usd',
          invoice: null,
          billing_details: { email },
          metadata: { price_id: INT_PRICE_IDS.creditPack, quantity: '1' },
        },
      },
    })

    try {
      const first = await mountAndPost(deps, chargeEvent(1000, 'evt_s6a'))
      assert.equal(first.status, 200)
      assert.deepEqual(JSON.parse(first.text), { received: true })

      const deductions = await getPool().query(
        `SELECT delta, reason, reference_id FROM credit_transactions
       WHERE user_id = $1 AND reason = 'stripe_refund' ORDER BY reference_id`,
        [user.id],
      )
      assert.equal(deductions.rowCount, 1)
      assert.equal(deductions.rows[0].delta, -5000) // floor(10000 * 1000/2000)
      assert.equal(deductions.rows[0].reference_id, 'ch_s6_1000')

      assert.equal(refund.calls.length, 1)
      assert.equal(refund.calls[0].valueMinorUnits, 1000)
      assert.equal(refund.calls[0].transactionId, 'ch_s6_1000')
    } finally {
      setStripeClientFactoryForTests(null)
    }
  },
)

test(
  'S6b: second partial refund claws back only the delta via the real refund-total ledger',
  { timeout: 10_000 },
  async () => {
    const email = synthEmail('stripe-s6b')
    const user = await seedUser('uid_stripe_s6b', email)
    const { deps } = makeRealStripeDeps()
    setStripeClientFactoryForTests(() => makeFakeStripe({}))

    const chargeEvent = (amountRefunded: number, eventId: string) => ({
      id: eventId,
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_s6b',
          amount: 2000,
          amount_refunded: amountRefunded,
          currency: 'usd',
          invoice: null,
          billing_details: { email },
          metadata: { price_id: INT_PRICE_IDS.creditPack, quantity: '1' },
        },
      },
    })

    try {
      await mountAndPost(deps, chargeEvent(1000, 'evt_s6b_1'))
      const second = await mountAndPost(deps, chargeEvent(2000, 'evt_s6b_2'))
      assert.equal(second.status, 200)

      const totals = await getPool().query(
        `SELECT coalesce(sum(delta), 0)::int AS total FROM credit_transactions
       WHERE user_id = $1 AND reason = 'stripe_refund'`,
        [user.id],
      )
      assert.equal(totals.rows[0].total, -10000) // -5000 then -5000; never double-clawed

      const refs = await getPool().query(
        `SELECT reference_id FROM credit_transactions
       WHERE user_id = $1 AND reason = 'stripe_refund' ORDER BY reference_id`,
        [user.id],
      )
      assert.deepEqual(
        refs.rows.map((r: { reference_id: string }) => r.reference_id),
        ['ch_s6b_1000', 'ch_s6b_2000'],
      )
    } finally {
      setStripeClientFactoryForTests(null)
    }
  },
)

test(
  'S6c: full refund of a subscription charge downgrades to free/cancelled',
  { timeout: 10_000 },
  async () => {
    const email = synthEmail('stripe-s6c')
    const user = await seedUser('uid_stripe_s6c', email)
    const { deps, refund } = makeRealStripeDeps()
    setStripeClientFactoryForTests(() =>
      makeFakeStripe({
        invoice: {
          parent: { subscription_details: { subscription: 'sub_s6c' } },
          lines: { data: [] },
        },
      }),
    )

    const event = {
      id: 'evt_s6c',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_s6c',
          amount: 2000,
          amount_refunded: 2000,
          currency: 'usd',
          invoice: 'in_s6c',
          billing_details: { email },
          metadata: {},
        },
      },
    }

    try {
      const { status } = await mountAndPost(deps, event)
      assert.equal(status, 200)

      const sub = await getPool().query(
        `SELECT plan_tier, plan_status, subscription_provider, cancel_at_period_end
       FROM subscriptions WHERE user_id = $1`,
        [user.id],
      )
      assert.equal(sub.rows[0].plan_tier, 'free')
      assert.equal(sub.rows[0].plan_status, 'cancelled')
      assert.equal(sub.rows[0].subscription_provider, null)
      assert.equal(sub.rows[0].cancel_at_period_end, false)

      assert.equal(refund.calls.length, 1)
      assert.equal(refund.calls[0].transactionId, 'ch_s6c')
    } finally {
      setStripeClientFactoryForTests(null)
    }
  },
)

test(
  'D1/D2: fresh claim succeeds; second claim within the lease window is rejected',
  { timeout: 10_000 },
  async () => {
    const claimed = await dedupe.markEventProcessed('evt_d1')
    assert.equal(claimed, true)
    const row = await getPool().query(
      `SELECT status FROM processed_stripe_events WHERE event_id = 'evt_d1'`,
    )
    assert.equal(row.rows[0].status, 'processing')
    assert.equal(await dedupe.markEventProcessed('evt_d1'), false)
  },
)

test('D3: backdating the lease past 5 minutes allows takeover', { timeout: 10_000 }, async () => {
  await dedupe.markEventProcessed('evt_d3')
  assert.equal(await dedupe.markEventProcessed('evt_d3'), false)

  await getPool().query(
    `UPDATE processed_stripe_events SET created_at = now() - interval '6 minutes' WHERE event_id = $1`,
    ['evt_d3'],
  )
  assert.equal(await dedupe.markEventProcessed('evt_d3'), true) // real expiry comparison, as shipped
})

test(
  'D4: complete blocks forever; unmark releases for a fresh claim',
  { timeout: 10_000 },
  async () => {
    await dedupe.markEventProcessed('evt_d4')
    await dedupe.completeEventProcessed('evt_d4')
    assert.equal(await dedupe.isEventProcessed('evt_d4'), true)
    assert.equal(await dedupe.markEventProcessed('evt_d4'), false)

    await dedupe.unmarkEventProcessed('evt_d4')
    assert.equal(await dedupe.isEventProcessed('evt_d4'), false)
    assert.equal(await dedupe.markEventProcessed('evt_d4'), true)
  },
)
