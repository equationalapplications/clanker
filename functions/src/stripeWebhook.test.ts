import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test, { TestContext } from 'node:test'
import Stripe from 'stripe'

process.env.STRIPE_SECRET_KEY = 'sk_test_123'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_123'
process.env.STRIPE_MONTHLY_20_PRICE_ID = 'price_monthly_20'
process.env.STRIPE_MONTHLY_50_PRICE_ID = 'price_monthly_50'
process.env.STRIPE_CREDIT_PACK_PRICE_ID = 'price_credit_pack'

import type { UpsertSubscriptionParams } from './services/subscriptionService.js'
import {
  getCreditPackQuantityFromInvoice,
  getInvoiceLineItemPriceId,
  mapStripeSubscriptionStatus,
  stripeWebhookHandler,
  handleCheckoutCompleted,
  handleInvoicePaymentSucceeded,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleChargeRefunded,
  setStripeClientFactoryForTests,
} from './stripeWebhook.js'

type ResponseRecorder = {
  statusCode: number
  body: unknown
  status: (code: number) => ResponseRecorder
  send: (value: unknown) => ResponseRecorder
  json: (value: unknown) => ResponseRecorder
}

function createResponseRecorder(): ResponseRecorder {
  return {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code
      return this
    },
    send(value: unknown) {
      this.body = value
      return this
    },
    json(value: unknown) {
      this.body = value
      return this
    },
  }
}

/**
 * Builds a genuinely-signed Stripe webhook header over the exact wire bytes:
 * `t=<unixSeconds>,v1=HMAC_SHA256(secret, "<t>.<payload>")`.
 * Used instead of stubbing constructEvent so bad-signature paths are real.
 */
const signStripeHeader = (
  payload: string,
  secret: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): string => {
  const timestamp = String(timestampSeconds)
  const mac = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')
  return `t=${timestamp},v1=${mac}`
}

/** Convenience POST body + header pair for one signed webhook delivery. */
const signedDelivery = (payloadJson: string, secret: string) => ({
  rawBody: Buffer.from(payloadJson, 'utf8'),
  headers: { 'stripe-signature': signStripeHeader(payloadJson, secret) },
})

test('stripeWebhookHandler only accepts POST', async () => {
  const res = createResponseRecorder()
  await stripeWebhookHandler({ method: 'GET', headers: {} } as never, res as never)

  assert.equal(res.statusCode, 405)
  assert.equal(res.body, 'Method Not Allowed')
})

test('stripeWebhookHandler validates signature header', async () => {
  const res = createResponseRecorder()

  await stripeWebhookHandler(
    {
      method: 'POST',
      headers: {},
      rawBody: Buffer.from('{}', 'utf8'),
    } as never,
    res as never,
  )

  assert.equal(res.statusCode, 400)
  assert.equal(res.body, 'Missing or invalid Stripe signature header')
})

test('stripeWebhookHandler returns 500 when STRIPE_WEBHOOK_SECRET is missing', async () => {
  const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  delete process.env.STRIPE_WEBHOOK_SECRET

  const res = createResponseRecorder()
  try {
    await stripeWebhookHandler(
      {
        method: 'POST',
        headers: {
          'stripe-signature': 't=1,v1=sig',
        },
        rawBody: Buffer.from('{}', 'utf8'),
      } as never,
      res as never,
    )

    assert.equal(res.statusCode, 500)
    assert.equal(res.body, 'Webhook secret not configured')
  } finally {
    process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret
  }
})

test('stripeWebhookHandler returns 500 when STRIPE_SECRET_KEY is missing', async () => {
  const originalSecretKey = process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_SECRET_KEY

  const res = createResponseRecorder()
  try {
    await stripeWebhookHandler(
      {
        method: 'POST',
        headers: {
          'stripe-signature': 't=1,v1=sig',
        },
        rawBody: Buffer.from('{}', 'utf8'),
      } as never,
      res as never,
    )

    assert.equal(res.statusCode, 500)
    assert.equal(res.body, 'Stripe configuration error')
  } finally {
    process.env.STRIPE_SECRET_KEY = originalSecretKey
  }
})

test('stripeWebhookHandler trims whitespace from STRIPE_WEBHOOK_SECRET and signature before verifying', async (t) => {
  const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  // Reproduce the production incident: the Secret Manager value had a trailing
  // newline, which made Stripe reject every event with a signature error.
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_123\n'

  const stripe = new Stripe('sk_test_123')
  setStripeClientFactoryForTests(() => stripe)
  t.after(() => {
    setStripeClientFactoryForTests(null)
    process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret
  })

  const res = createResponseRecorder()
  const deps = {
    findUserByEmail: async () => null,
    findUserByFirebaseUid: async () => null,
    findUserByStripeCustomerId: async () => null,
    upsertSubscription: async () => {},
    renewSubscriptionCredits: async () => false,
    addCredits: async () => {},
    adjustCredits: async () => {},
    markEventProcessed: async () => true,
    completeEventProcessed: async () => {},
    unmarkEventProcessed: async () => {},
    getLastProcessedChargeRefundTotal: async () => 0,
  }

  // Sign over the exact wire bytes using the TRIMMED secret. If the handler
  // failed to trim the env value, verification would fail with a 400 — the
  // same incident, now reproduced through real HMAC verification.
  const eventPayload = JSON.stringify({
    id: 'evt_trim_1',
    type: 'unhandled.event',
    data: { object: {} },
  })
  await stripeWebhookHandler(
    {
      method: 'POST',
      rawBody: Buffer.from(eventPayload, 'utf8'),
      // Pad the header too: the handler must trim it before verifying.
      headers: {
        'stripe-signature': `  ${signStripeHeader(eventPayload, 'whsec_test_123')}  `,
      },
    } as never,
    res as never,
    deps as never,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { received: true })
})

test('stripeWebhookHandler does not call sendPurchaseEvent for an already-processed event', async (t) => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_123'
  const stripe = new Stripe('sk_test_123')
  setStripeClientFactoryForTests(() => stripe)
  t.after(() => setStripeClientFactoryForTests(null))

  const eventPayload = JSON.stringify({
    id: 'evt_dedupe_1',
    type: 'checkout.session.completed',
    data: { object: {} },
  })

  const res = createResponseRecorder()
  let called = false
  const deps = {
    findUserByEmail: async () => ({
      id: 'user-1',
      email: 'person@example.com',
      firebaseUid: 'firebase-uid-1',
    }),
    findUserByFirebaseUid: async () => null,
    findUserByStripeCustomerId: async () => null,
    upsertSubscription: async () => {},
    renewSubscriptionCredits: async () => false,
    addCredits: async () => {},
    adjustCredits: async () => {},
    sendPurchaseEvent: async () => {
      called = true
    },
    markEventProcessed: async () => false, // already processed → dedupe short-circuits before dispatch
    completeEventProcessed: async () => {},
    unmarkEventProcessed: async () => {},
    getLastProcessedChargeRefundTotal: async () => 0,
  }

  await stripeWebhookHandler(
    {
      method: 'POST',
      ...signedDelivery(eventPayload, 'whsec_test_123'),
    } as never,
    res as never,
    deps as never,
  )

  assert.equal(res.statusCode, 200)
  assert.equal(called, false)
})

test('mapStripeSubscriptionStatus maps active-like statuses to active', () => {
  const statuses: Stripe.Subscription.Status[] = [
    'active',
    'trialing',
    'past_due',
    'unpaid',
    'incomplete',
  ]

  for (const status of statuses) {
    assert.equal(mapStripeSubscriptionStatus(status), 'active')
  }
})

test('mapStripeSubscriptionStatus maps canceled to cancelled', () => {
  assert.equal(mapStripeSubscriptionStatus('canceled'), 'cancelled')
})

test('mapStripeSubscriptionStatus maps expired-like statuses to expired', () => {
  assert.equal(mapStripeSubscriptionStatus('incomplete_expired'), 'expired')
  assert.equal(mapStripeSubscriptionStatus('paused'), 'expired')
})

test('getInvoiceLineItemPriceId reads price details ids', () => {
  const priceItem = {
    pricing: {
      price_details: {
        price: { id: 'price_credit_pack' },
      },
      type: 'price_details',
      unit_amount_decimal: null,
    },
  } as unknown as Stripe.InvoiceLineItem
  const planOnlyItem = {
    pricing: {
      price_details: {
        price: 'price_credit_pack_legacy',
      },
      type: 'price_details',
      unit_amount_decimal: null,
    },
  } as unknown as Stripe.InvoiceLineItem

  assert.equal(getInvoiceLineItemPriceId(priceItem), 'price_credit_pack')
  assert.equal(getInvoiceLineItemPriceId(planOnlyItem), 'price_credit_pack_legacy')
})

test('getCreditPackQuantityFromInvoice counts only configured credit-pack lines', () => {
  const invoice = {
    lines: {
      data: [
        {
          quantity: 2,
          pricing: {
            price_details: { price: 'price_credit_pack' },
            type: 'price_details',
            unit_amount_decimal: null,
          },
        },
        {
          quantity: null,
          pricing: {
            price_details: { price: { id: 'price_credit_pack' } },
            type: 'price_details',
            unit_amount_decimal: null,
          },
        },
        {
          quantity: 5,
          pricing: {
            price_details: { price: 'price_other' },
            type: 'price_details',
            unit_amount_decimal: null,
          },
        },
      ] as unknown as Stripe.InvoiceLineItem[],
    },
  } as unknown as Stripe.Invoice

  const quantity = getCreditPackQuantityFromInvoice(invoice, {
    monthly20: 'price_monthly_20',
    monthly50: 'price_monthly_50',
    creditPack: 'price_credit_pack',
  })

  assert.equal(quantity, 3)
})

test('handleInvoicePaymentSucceeded renews subscription credits only on subscription_cycle invoices', async () => {
  let renewalArgs: unknown = null

  const invoice = {
    id: 'inv_123',
    customer_email: 'person@example.com',
    billing_reason: 'subscription_cycle',
    parent: {
      subscription_details: { subscription: 'sub_123' },
    },
    lines: { data: [] },
  } as unknown as Stripe.Invoice

  const mockStripe = {
    subscriptions: {
      retrieve: async (_id: string) => ({ current_period_end: 1710000000 }),
    },
  } as unknown as Stripe

  await handleInvoicePaymentSucceeded(
    mockStripe,
    invoice,
    {
      monthly20: 'price_monthly_20',
      monthly50: 'price_monthly_50',
      creditPack: 'price_credit_pack',
    },
    {
      findUserByEmail: async (email: string) => ({ id: 'user-1', email }),
      findUserByFirebaseUid: async () => null,
      findUserByStripeCustomerId: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async (
        userId: string,
        amount: number,
        expiresAt: Date,
        referenceId: string,
      ) => {
        renewalArgs = { userId, amount, expiresAt, referenceId }
        return true
      },
      addCredits: async () => {},
      adjustCredits: async () => {},
      markEventProcessed: async () => true,
      isEventProcessed: async () => false,
      getLastProcessedChargeRefundTotal: async () => 0,
    } as never,
  )

  assert.deepEqual(renewalArgs, {
    userId: 'user-1',
    amount: 30000,
    expiresAt: new Date(1710000000 * 1000),
    referenceId: 'sub_sub_123_1710000000',
  })
})

test('handleCheckoutCompleted sends a GA4 purchase event for a credit-pack purchase', async () => {
  let sentEvent: unknown = null

  const session = {
    id: 'cs_test_credit_pack',
    customer_details: { email: 'person@example.com' },
    customer_email: 'person@example.com',
    client_reference_id: null,
    subscription: null,
    customer: 'cus_123',
    amount_total: 1000,
    currency: 'usd',
  } as unknown as Stripe.Checkout.Session

  const mockStripe = {
    checkout: {
      sessions: {
        listLineItems: async (_sessionId: string) => ({
          data: [{ price: { id: 'price_credit_pack' }, quantity: 1, amount_total: 1000 }],
        }),
      },
    },
  } as unknown as Stripe

  await handleCheckoutCompleted(
    mockStripe,
    session,
    {
      monthly20: 'price_monthly_20',
      monthly50: 'price_monthly_50',
      creditPack: 'price_credit_pack',
    },
    {
      findUserByEmail: async (email: string) => ({
        id: 'user-1',
        email,
        firebaseUid: 'firebase-uid-1',
      }),
      findUserByFirebaseUid: async () => null,
      findUserByStripeCustomerId: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => false,
      addCredits: async () => {},
      adjustCredits: async () => {},
      sendPurchaseEvent: async (params: unknown) => {
        sentEvent = params
      },
    } as never,
  )

  assert.deepEqual(sentEvent, {
    firebaseUid: 'firebase-uid-1',
    transactionId: 'cs_test_credit_pack',
    valueMinorUnits: 1000,
    currency: 'usd',
    paymentProvider: 'stripe',
  })
})

test('handleCheckoutCompleted sends only the credit-pack subtotal for a mixed subscription + credit-pack cart', async () => {
  let sentEvent: unknown = null

  const session = {
    id: 'cs_test_mixed_cart',
    customer_details: { email: 'person@example.com' },
    customer_email: 'person@example.com',
    client_reference_id: null,
    subscription: 'sub_123',
    customer: 'cus_123',
    amount_total: 3000,
    currency: 'usd',
  } as unknown as Stripe.Checkout.Session

  const mockStripe = {
    checkout: {
      sessions: {
        listLineItems: async (_sessionId: string) => ({
          data: [
            { price: { id: 'price_monthly_20' }, quantity: 1, amount_total: 2000 },
            { price: { id: 'price_credit_pack' }, quantity: 1, amount_total: 1000 },
          ],
        }),
      },
    },
    subscriptions: {
      retrieve: async (_id: string) => ({ current_period_end: 1710000000 }),
    },
  } as unknown as Stripe

  await handleCheckoutCompleted(
    mockStripe,
    session,
    {
      monthly20: 'price_monthly_20',
      monthly50: 'price_monthly_50',
      creditPack: 'price_credit_pack',
    },
    {
      findUserByEmail: async (email: string) => ({
        id: 'user-1',
        email,
        firebaseUid: 'firebase-uid-1',
      }),
      findUserByFirebaseUid: async () => null,
      findUserByStripeCustomerId: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => true,
      addCredits: async () => {},
      adjustCredits: async () => {},
      sendPurchaseEvent: async (params: unknown) => {
        sentEvent = params
      },
    } as never,
  )

  assert.deepEqual(sentEvent, {
    firebaseUid: 'firebase-uid-1',
    transactionId: 'cs_test_mixed_cart',
    valueMinorUnits: 1000,
    currency: 'usd',
    paymentProvider: 'stripe',
  })
})

test('handleCheckoutCompleted does not send a GA4 purchase event for a subscription-only purchase', async () => {
  let called = false

  const session = {
    id: 'cs_test_sub',
    customer_details: { email: 'person@example.com' },
    customer_email: 'person@example.com',
    client_reference_id: null,
    subscription: 'sub_123',
    customer: 'cus_123',
    amount_total: 2000,
    currency: 'usd',
  } as unknown as Stripe.Checkout.Session

  const mockStripe = {
    checkout: {
      sessions: {
        listLineItems: async (_sessionId: string) => ({
          data: [{ price: { id: 'price_monthly_20' }, quantity: 1 }],
        }),
      },
    },
    subscriptions: {
      retrieve: async (_id: string) => ({ current_period_end: 1710000000 }),
    },
  } as unknown as Stripe

  await handleCheckoutCompleted(
    mockStripe,
    session,
    {
      monthly20: 'price_monthly_20',
      monthly50: 'price_monthly_50',
      creditPack: 'price_credit_pack',
    },
    {
      findUserByEmail: async (email: string) => ({
        id: 'user-1',
        email,
        firebaseUid: 'firebase-uid-1',
      }),
      findUserByFirebaseUid: async () => null,
      findUserByStripeCustomerId: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => true,
      addCredits: async () => {},
      adjustCredits: async () => {},
      sendPurchaseEvent: async () => {
        called = true
      },
    } as never,
  )

  assert.equal(called, false)
})

test('handleCheckoutCompleted skips the GA4 purchase event when firebaseUid is missing', async () => {
  let called = false

  const session = {
    id: 'cs_test_no_uid',
    customer_details: { email: 'person@example.com' },
    customer_email: 'person@example.com',
    client_reference_id: null,
    subscription: null,
    customer: 'cus_123',
    amount_total: 1000,
    currency: 'usd',
  } as unknown as Stripe.Checkout.Session

  const mockStripe = {
    checkout: {
      sessions: {
        listLineItems: async (_sessionId: string) => ({
          data: [{ price: { id: 'price_credit_pack' }, quantity: 1 }],
        }),
      },
    },
  } as unknown as Stripe

  await handleCheckoutCompleted(
    mockStripe,
    session,
    {
      monthly20: 'price_monthly_20',
      monthly50: 'price_monthly_50',
      creditPack: 'price_credit_pack',
    },
    {
      findUserByEmail: async (email: string) => ({ id: 'user-1', email }),
      findUserByFirebaseUid: async () => null,
      findUserByStripeCustomerId: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => false,
      addCredits: async () => {},
      adjustCredits: async () => {},
      sendPurchaseEvent: async () => {
        called = true
      },
    } as never,
  )

  assert.equal(called, false)
})

test('handleSubscriptionUpdated renews credits when planStatus is active', async () => {
  let renewalArgs: unknown = null

  const sub = {
    id: 'sub_abc',
    status: 'active',
    current_period_end: 1720000000,
    items: { data: [{ price: { id: 'price_monthly_20' } }] },
    customer: 'cus_123',
  } as unknown as Stripe.Subscription

  const mockStripe = {
    customers: {
      retrieve: async (_id: string) => ({ deleted: false, email: 'user@example.com' }),
    },
  } as unknown as Stripe

  await handleSubscriptionUpdated(
    sub,
    mockStripe,
    {
      monthly20: 'price_monthly_20',
      monthly50: 'price_monthly_50',
      creditPack: 'price_credit_pack',
    },
    {
      findUserByEmail: async (email: string) => ({ id: 'user-1', email }),
      findUserByFirebaseUid: async () => null,
      findUserByStripeCustomerId: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async (
        userId: string,
        amount: number,
        expiresAt: Date,
        referenceId: string,
      ) => {
        renewalArgs = { userId, amount, expiresAt, referenceId }
        return true
      },
      addCredits: async () => {},
      adjustCredits: async () => {},
      markEventProcessed: async () => true,
      isEventProcessed: async () => false,
      getLastProcessedChargeRefundTotal: async () => 0,
    } as never,
  )

  assert.deepEqual(renewalArgs, {
    userId: 'user-1',
    amount: 30000,
    expiresAt: new Date(1720000000 * 1000),
    referenceId: 'sub_sub_abc_1720000000',
  })
})

test('handleSubscriptionUpdated does not renew credits when planStatus is not active', async () => {
  let renewalCalled = false

  const sub = {
    id: 'sub_abc',
    status: 'canceled',
    current_period_end: 1720000000,
    items: { data: [{ price: { id: 'price_monthly_20' } }] },
    customer: 'cus_123',
  } as unknown as Stripe.Subscription

  const mockStripe = {
    customers: {
      retrieve: async (_id: string) => ({ deleted: false, email: 'user@example.com' }),
    },
  } as unknown as Stripe

  await handleSubscriptionUpdated(
    sub,
    mockStripe,
    {
      monthly20: 'price_monthly_20',
      monthly50: 'price_monthly_50',
      creditPack: 'price_credit_pack',
    },
    {
      findUserByEmail: async (email: string) => ({ id: 'user-1', email }),
      findUserByFirebaseUid: async () => null,
      findUserByStripeCustomerId: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => {
        renewalCalled = true
        return true
      },
      addCredits: async () => {},
      adjustCredits: async () => {},
      markEventProcessed: async () => true,
      isEventProcessed: async () => false,
      getLastProcessedChargeRefundTotal: async () => 0,
    } as never,
  )

  assert.equal(renewalCalled, false)
})

/**
 * Installs a real SDK Stripe client for stripeWebhookHandler: constructEvent
 * verification now runs for real, while the factory keeps serving the
 * REST-callback stubs (e.g. mocked customers.retrieve) individual tests set up.
 */
function useTestStripeClient(t: TestContext) {
  const stripe = new Stripe('sk_test_123')
  setStripeClientFactoryForTests(() => stripe)
  t.after(() => {
    setStripeClientFactoryForTests(null)
  })
}

test('stripeWebhookHandler skips dispatch and returns 200 for an already-processed event', async (t) => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_123'
  const res = createResponseRecorder()
  const eventPayload = JSON.stringify({
    id: 'evt_dup_1',
    type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_1', customer: 'cus_1' } },
  })
  useTestStripeClient(t)

  let dispatched = false
  const deps = {
    findUserByEmail: async () => {
      dispatched = true
      return null
    },
    findUserByFirebaseUid: async () => null,
    findUserByStripeCustomerId: async () => null,
    upsertSubscription: async () => {},
    renewSubscriptionCredits: async () => false,
    addCredits: async () => {},
    adjustCredits: async () => {},
    markEventProcessed: async () => false,
    completeEventProcessed: async () => {
      throw new Error('should not complete duplicate events')
    },
    unmarkEventProcessed: async () => {
      throw new Error('should not unmark duplicate events')
    },
    getLastProcessedChargeRefundTotal: async () => 0,
  }

  await stripeWebhookHandler(
    {
      method: 'POST',
      ...signedDelivery(eventPayload, 'whsec_test_123'),
    } as never,
    res as never,
    deps as never,
  )

  assert.equal(res.statusCode, 200)
  assert.equal(dispatched, false)
})

test('stripeWebhookHandler unmarks the event when handler dispatch throws, so Stripe can retry', async (t) => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_123'
  const res = createResponseRecorder()
  const eventPayload = JSON.stringify({
    id: 'evt_fail_1',
    type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_1', customer: 'cus_1' } },
  })
  useTestStripeClient(t)

  let markedEventId: string | null = null
  let unmarkedEventId: string | null = null
  const stripeProto = Object.getPrototypeOf(new Stripe('sk_test_123').customers)
  t.mock.method(stripeProto, 'retrieve', async () => {
    throw new Error('Cloud SQL unavailable')
  })

  const deps = {
    findUserByEmail: async () => null,
    findUserByFirebaseUid: async () => null,
    findUserByStripeCustomerId: async () => null,
    upsertSubscription: async () => {},
    renewSubscriptionCredits: async () => false,
    addCredits: async () => {},
    adjustCredits: async () => {},
    markEventProcessed: async (eventId: string) => {
      markedEventId = eventId
      return true
    },
    completeEventProcessed: async () => {},
    unmarkEventProcessed: async (eventId: string) => {
      unmarkedEventId = eventId
    },
    getLastProcessedChargeRefundTotal: async () => 0,
  }

  await stripeWebhookHandler(
    {
      method: 'POST',
      ...signedDelivery(eventPayload, 'whsec_test_123'),
    } as never,
    res as never,
    deps as never,
  )

  assert.equal(res.statusCode, 500)
  assert.equal(markedEventId, 'evt_fail_1')
  assert.equal(unmarkedEventId, 'evt_fail_1')
})

test('handleSubscriptionUpdated falls back to metadata.firebase_uid when customer has no email', async () => {
  let renewalArgs: unknown = null
  let firebaseUidLookedUp: string | null = null

  const sub = {
    id: 'sub_abc',
    status: 'active',
    current_period_end: 1720000000,
    cancel_at_period_end: false,
    items: { data: [{ price: { id: 'price_monthly_20' } }] },
    customer: 'cus_123',
  } as unknown as Stripe.Subscription

  const mockStripe = {
    customers: {
      retrieve: async (_id: string) => ({
        deleted: false,
        email: null,
        metadata: { firebase_uid: 'firebase-uid-1' },
      }),
    },
  } as unknown as Stripe

  await handleSubscriptionUpdated(
    sub,
    mockStripe,
    {
      monthly20: 'price_monthly_20',
      monthly50: 'price_monthly_50',
      creditPack: 'price_credit_pack',
    },
    {
      findUserByEmail: async () => null,
      findUserByFirebaseUid: async (uid: string) => {
        firebaseUidLookedUp = uid
        return { id: 'user-1', email: 'user@example.com' }
      },
      findUserByStripeCustomerId: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async (
        userId: string,
        amount: number,
        expiresAt: Date,
        referenceId: string,
      ) => {
        renewalArgs = { userId, amount, expiresAt, referenceId }
        return true
      },
      addCredits: async () => {},
      adjustCredits: async () => {},
    } as never,
  )

  assert.equal(firebaseUidLookedUp, 'firebase-uid-1')
  assert.deepEqual(renewalArgs, {
    userId: 'user-1',
    amount: 30000,
    expiresAt: new Date(1720000000 * 1000),
    referenceId: 'sub_sub_abc_1720000000',
  })
})

test('handleSubscriptionUpdated falls back to stored stripe_customer_id when email and metadata both fail', async () => {
  let renewalArgs: unknown = null
  let customerIdLookedUp: string | null = null

  const sub = {
    id: 'sub_abc',
    status: 'active',
    current_period_end: 1720000000,
    cancel_at_period_end: false,
    items: { data: [{ price: { id: 'price_monthly_20' } }] },
    customer: 'cus_123',
  } as unknown as Stripe.Subscription

  const mockStripe = {
    customers: {
      retrieve: async (_id: string) => ({ deleted: false, email: null, metadata: {} }),
    },
  } as unknown as Stripe

  await handleSubscriptionUpdated(
    sub,
    mockStripe,
    {
      monthly20: 'price_monthly_20',
      monthly50: 'price_monthly_50',
      creditPack: 'price_credit_pack',
    },
    {
      findUserByEmail: async () => null,
      findUserByFirebaseUid: async () => null,
      findUserByStripeCustomerId: async (customerId: string) => {
        customerIdLookedUp = customerId
        return { id: 'user-1', email: 'user@example.com' }
      },
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async (
        userId: string,
        amount: number,
        expiresAt: Date,
        referenceId: string,
      ) => {
        renewalArgs = { userId, amount, expiresAt, referenceId }
        return true
      },
      addCredits: async () => {},
      adjustCredits: async () => {},
    } as never,
  )

  assert.equal(customerIdLookedUp, 'cus_123')
  assert.ok(renewalArgs !== null)
})

test('handleSubscriptionUpdated no-ops when all lookup strategies fail', async () => {
  let upsertCalled = false

  const sub = {
    id: 'sub_abc',
    status: 'active',
    current_period_end: 1720000000,
    cancel_at_period_end: false,
    items: { data: [{ price: { id: 'price_monthly_20' } }] },
    customer: 'cus_123',
  } as unknown as Stripe.Subscription

  const mockStripe = {
    customers: {
      retrieve: async (_id: string) => ({ deleted: false, email: null, metadata: {} }),
    },
  } as unknown as Stripe

  await handleSubscriptionUpdated(
    sub,
    mockStripe,
    {
      monthly20: 'price_monthly_20',
      monthly50: 'price_monthly_50',
      creditPack: 'price_credit_pack',
    },
    {
      findUserByEmail: async () => null,
      findUserByFirebaseUid: async () => null,
      findUserByStripeCustomerId: async () => null,
      upsertSubscription: async () => {
        upsertCalled = true
      },
      renewSubscriptionCredits: async () => true,
      addCredits: async () => {},
      adjustCredits: async () => {},
    } as never,
  )

  assert.equal(upsertCalled, false)
})

test('handleSubscriptionDeleted nulls subscriptionProvider and resets to free/cancelled', async () => {
  let upsertArgs: UpsertSubscriptionParams | null = null

  const sub = {
    id: 'sub_abc',
    customer: 'cus_123',
  } as unknown as Stripe.Subscription

  const mockStripe = {
    customers: {
      retrieve: async (_id: string) => ({ deleted: false, email: 'user@example.com' }),
    },
  } as unknown as Stripe

  await handleSubscriptionDeleted(sub, mockStripe, {
    findUserByEmail: async (email: string) => ({ id: 'user-1', email }),
    findUserByFirebaseUid: async () => null,
    findUserByStripeCustomerId: async () => null,
    upsertSubscription: async (params: UpsertSubscriptionParams) => {
      upsertArgs = params
    },
    renewSubscriptionCredits: async () => false,
    addCredits: async () => {},
    adjustCredits: async () => {},
  } as never)

  assert.deepEqual(upsertArgs, {
    userId: 'user-1',
    planTier: 'free',
    planStatus: 'cancelled',
    stripeSubscriptionId: 'sub_abc',
    stripeCustomerId: 'cus_123',
    subscriptionProvider: null,
    cancelAtPeriodEnd: false,
  })
})

test('handleSubscriptionUpdated maps Stripe cancel_at_period_end onto upsertSubscription', async () => {
  const upsertCalls: UpsertSubscriptionParams[] = []

  const sub = {
    id: 'sub_abc',
    status: 'active',
    current_period_end: 1720000000,
    cancel_at_period_end: true,
    items: { data: [{ price: { id: 'price_monthly_20' } }] },
    customer: 'cus_123',
  } as unknown as Stripe.Subscription

  const mockStripe = {
    customers: {
      retrieve: async (_id: string) => ({ deleted: false, email: 'user@example.com' }),
    },
  } as unknown as Stripe

  await handleSubscriptionUpdated(
    sub,
    mockStripe,
    {
      monthly20: 'price_monthly_20',
      monthly50: 'price_monthly_50',
      creditPack: 'price_credit_pack',
    },
    {
      findUserByEmail: async (email: string) => ({ id: 'user-1', email }),
      findUserByFirebaseUid: async () => null,
      findUserByStripeCustomerId: async () => null,
      upsertSubscription: async (params: UpsertSubscriptionParams) => {
        upsertCalls.push(params)
      },
      renewSubscriptionCredits: async () => true,
      addCredits: async () => {},
      adjustCredits: async () => {},
    } as never,
  )

  assert.equal(upsertCalls[0]?.subscriptionProvider, 'stripe')
  assert.equal(upsertCalls[0]?.cancelAtPeriodEnd, true)
})

test('handleChargeRefunded deducts the full amount on a full refund', async () => {
  let adjustArgs: { delta: number; reason: string; referenceId?: string } | null = null

  const charge = {
    id: 'ch_123',
    amount: 1000,
    amount_refunded: 1000,
    billing_details: { email: 'user@example.com' },
    invoice: 'in_123',
  } as unknown as Stripe.Charge

  const mockStripe = {
    invoices: {
      retrieve: async () => ({
        parent: { subscription_details: { subscription: null } },
        lines: {
          data: [
            {
              quantity: 1,
              pricing: { price_details: { price: 'price_credit_pack' } },
            },
          ],
        },
      }),
    },
  } as unknown as Stripe

  await handleChargeRefunded(
    mockStripe,
    charge,
    {
      monthly20: 'price_monthly_20',
      monthly50: 'price_monthly_50',
      creditPack: 'price_credit_pack',
    },
    {
      findUserByEmail: async (email: string) => ({ id: 'user-1', email }),
      findUserByFirebaseUid: async () => null,
      findUserByStripeCustomerId: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => false,
      addCredits: async () => {},
      adjustCredits: async (
        _userId: string,
        delta: number,
        reason: string,
        referenceId?: string,
      ) => {
        adjustArgs = { delta, reason, referenceId }
      },
      getLastProcessedChargeRefundTotal: async () => 0,
    } as never,
  )

  assert.deepEqual(adjustArgs, {
    delta: -10000,
    reason: 'stripe_refund',
    referenceId: 'ch_123_1000',
  })
})

test('handleChargeRefunded prorates a partial refund', async () => {
  let adjustArgs: { delta: number } | null = null

  const charge = {
    id: 'ch_124',
    amount: 1000,
    amount_refunded: 200,
    billing_details: { email: 'user@example.com' },
    invoice: 'in_124',
  } as unknown as Stripe.Charge

  const mockStripe = {
    invoices: {
      retrieve: async () => ({
        parent: { subscription_details: { subscription: null } },
        lines: {
          data: [
            {
              quantity: 1,
              pricing: { price_details: { price: 'price_credit_pack' } },
            },
          ],
        },
      }),
    },
  } as unknown as Stripe

  await handleChargeRefunded(
    mockStripe,
    charge,
    {
      monthly20: 'price_monthly_20',
      monthly50: 'price_monthly_50',
      creditPack: 'price_credit_pack',
    },
    {
      findUserByEmail: async (email: string) => ({ id: 'user-1', email }),
      findUserByFirebaseUid: async () => null,
      findUserByStripeCustomerId: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => false,
      addCredits: async () => {},
      adjustCredits: async (_userId: string, delta: number) => {
        adjustArgs = { delta }
      },
      getLastProcessedChargeRefundTotal: async () => 0,
    } as never,
  )

  assert.deepEqual(adjustArgs, { delta: -2000 })
})

test('handleChargeRefunded does not call adjustCredits when charge.amount is 0', async () => {
  let adjustCalled = false

  const charge = {
    id: 'ch_125',
    amount: 0,
    amount_refunded: 0,
    billing_details: { email: 'user@example.com' },
    invoice: 'in_125',
  } as unknown as Stripe.Charge

  const mockStripe = {
    invoices: {
      retrieve: async () => ({
        parent: { subscription_details: { subscription: null } },
        lines: {
          data: [
            {
              quantity: 1,
              pricing: { price_details: { price: 'price_credit_pack' } },
            },
          ],
        },
      }),
    },
  } as unknown as Stripe

  await handleChargeRefunded(
    mockStripe,
    charge,
    {
      monthly20: 'price_monthly_20',
      monthly50: 'price_monthly_50',
      creditPack: 'price_credit_pack',
    },
    {
      findUserByEmail: async (email: string) => ({ id: 'user-1', email }),
      findUserByFirebaseUid: async () => null,
      findUserByStripeCustomerId: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => false,
      addCredits: async () => {},
      adjustCredits: async () => {
        adjustCalled = true
      },
      getLastProcessedChargeRefundTotal: async () => 0,
    } as never,
  )

  assert.equal(adjustCalled, false)
})

test('handleChargeRefunded nulls subscriptionProvider on a subscription refund', async () => {
  const upsertCalls: UpsertSubscriptionParams[] = []

  const charge = {
    id: 'ch_126',
    amount: 2000,
    amount_refunded: 2000,
    billing_details: { email: 'user@example.com' },
    invoice: 'in_126',
  } as unknown as Stripe.Charge

  const mockStripe = {
    invoices: {
      retrieve: async () => ({
        parent: { subscription_details: { subscription: 'sub_1' } },
        lines: { data: [] },
      }),
    },
  } as unknown as Stripe

  await handleChargeRefunded(
    mockStripe,
    charge,
    {
      monthly20: 'price_monthly_20',
      monthly50: 'price_monthly_50',
      creditPack: 'price_credit_pack',
    },
    {
      findUserByEmail: async (email: string) => ({ id: 'user-1', email }),
      findUserByFirebaseUid: async () => null,
      findUserByStripeCustomerId: async () => null,
      upsertSubscription: async (params: UpsertSubscriptionParams) => {
        upsertCalls.push(params)
      },
      renewSubscriptionCredits: async () => false,
      addCredits: async () => {},
      adjustCredits: async () => {},
      getLastProcessedChargeRefundTotal: async () => 0,
    } as never,
  )

  assert.equal(upsertCalls[0]?.subscriptionProvider, null)
})

test('handleChargeRefunded uses a per-refund referenceId so sequential partial refunds do not collide', async () => {
  const adjustCalls: Array<{ delta: number; referenceId?: string }> = []
  const processedRefundTotals: Record<string, number> = {}

  const mockStripe = {
    invoices: {
      retrieve: async () => ({
        parent: { subscription_details: { subscription: null } },
        lines: {
          data: [
            {
              quantity: 1,
              pricing: { price_details: { price: 'price_credit_pack' } },
            },
          ],
        },
      }),
    },
  } as unknown as Stripe

  const deps = {
    findUserByEmail: async (email: string) => ({ id: 'user-1', email }),
    findUserByFirebaseUid: async () => null,
    findUserByStripeCustomerId: async () => null,
    upsertSubscription: async () => {},
    renewSubscriptionCredits: async () => false,
    addCredits: async () => {},
    getLastProcessedChargeRefundTotal: async (chargeId: string) =>
      processedRefundTotals[chargeId] ?? 0,
    adjustCredits: async (
      _userId: string,
      delta: number,
      _reason: string,
      referenceId?: string,
    ) => {
      adjustCalls.push({ delta, referenceId })
      if (referenceId) {
        const separatorIndex = referenceId.lastIndexOf('_')
        const chargeId = referenceId.slice(0, separatorIndex)
        const amountRefunded = Number(referenceId.slice(separatorIndex + 1))
        if (Number.isFinite(amountRefunded)) {
          processedRefundTotals[chargeId] = Math.max(
            processedRefundTotals[chargeId] ?? 0,
            amountRefunded,
          )
        }
      }
    },
  } as never

  const priceIds = {
    monthly20: 'price_monthly_20',
    monthly50: 'price_monthly_50',
    creditPack: 'price_credit_pack',
  }

  await handleChargeRefunded(
    mockStripe,
    {
      id: 'ch_partial',
      amount: 1000,
      amount_refunded: 200,
      billing_details: { email: 'user@example.com' },
      invoice: 'in_partial_1',
    } as unknown as Stripe.Charge,
    priceIds,
    deps,
  )

  await handleChargeRefunded(
    mockStripe,
    {
      id: 'ch_partial',
      amount: 1000,
      amount_refunded: 500,
      billing_details: { email: 'user@example.com' },
      invoice: 'in_partial_1',
    } as unknown as Stripe.Charge,
    priceIds,
    deps,
  )

  assert.equal(adjustCalls.length, 2)
  assert.deepEqual(adjustCalls[0], { delta: -2000, referenceId: 'ch_partial_200' })
  assert.deepEqual(adjustCalls[1], { delta: -3000, referenceId: 'ch_partial_500' })
})

test('handleChargeRefunded cumulative proration deducts full grant after many small partial refunds', async () => {
  const adjustCalls: Array<{ delta: number; referenceId?: string }> = []
  const processedRefundTotals: Record<string, number> = {}

  const mockStripe = {
    invoices: {
      retrieve: async () => ({
        parent: { subscription_details: { subscription: null } },
        lines: {
          data: [
            {
              quantity: 1,
              pricing: { price_details: { price: 'price_credit_pack' } },
            },
          ],
        },
      }),
    },
  } as unknown as Stripe

  const deps = {
    findUserByEmail: async (email: string) => ({ id: 'user-1', email }),
    findUserByFirebaseUid: async () => null,
    findUserByStripeCustomerId: async () => null,
    upsertSubscription: async () => {},
    renewSubscriptionCredits: async () => false,
    addCredits: async () => {},
    getLastProcessedChargeRefundTotal: async (chargeId: string) =>
      processedRefundTotals[chargeId] ?? 0,
    adjustCredits: async (
      _userId: string,
      delta: number,
      _reason: string,
      referenceId?: string,
    ) => {
      adjustCalls.push({ delta, referenceId })
      if (referenceId) {
        const separatorIndex = referenceId.lastIndexOf('_')
        const chargeId = referenceId.slice(0, separatorIndex)
        const amountRefunded = Number(referenceId.slice(separatorIndex + 1))
        if (Number.isFinite(amountRefunded)) {
          processedRefundTotals[chargeId] = Math.max(
            processedRefundTotals[chargeId] ?? 0,
            amountRefunded,
          )
        }
      }
    },
  } as never

  const priceIds = {
    monthly20: 'price_monthly_20',
    monthly50: 'price_monthly_50',
    creditPack: 'price_credit_pack',
  }

  const chargeBase = {
    id: 'ch_many_partial',
    amount: 333,
    billing_details: { email: 'user@example.com' },
    invoice: 'in_many_partial',
  }

  for (const amountRefunded of [111, 222, 333]) {
    await handleChargeRefunded(
      mockStripe,
      {
        ...chargeBase,
        amount_refunded: amountRefunded,
      } as unknown as Stripe.Charge,
      priceIds,
      deps,
    )
  }

  const totalDeducted = adjustCalls.reduce((sum, call) => sum + call.delta, 0)
  assert.equal(totalDeducted, -10000)
})

test('handleSubscriptionDeleted falls back to stored stripe_customer_id when Stripe customer is deleted', async () => {
  let upsertArgs: UpsertSubscriptionParams | null = null
  let customerIdLookedUp: string | null = null

  const sub = {
    id: 'sub_deleted_customer',
    customer: 'cus_deleted',
  } as unknown as Stripe.Subscription

  const mockStripe = {
    customers: {
      retrieve: async (_id: string) => ({ deleted: true }),
    },
  } as unknown as Stripe

  await handleSubscriptionDeleted(sub, mockStripe, {
    findUserByEmail: async () => {
      throw new Error('should not lookup by email for deleted customer')
    },
    findUserByFirebaseUid: async () => {
      throw new Error('should not lookup by firebase uid for deleted customer')
    },
    findUserByStripeCustomerId: async (customerId: string) => {
      customerIdLookedUp = customerId
      return { id: 'user-1', email: 'user@example.com' }
    },
    upsertSubscription: async (params: UpsertSubscriptionParams) => {
      upsertArgs = params
    },
    renewSubscriptionCredits: async () => false,
    addCredits: async () => {},
    adjustCredits: async () => {},
    getLastProcessedChargeRefundTotal: async () => 0,
  } as never)

  assert.equal(customerIdLookedUp, 'cus_deleted')
  assert.deepEqual(upsertArgs, {
    userId: 'user-1',
    planTier: 'free',
    planStatus: 'cancelled',
    stripeSubscriptionId: 'sub_deleted_customer',
    stripeCustomerId: 'cus_deleted',
    subscriptionProvider: null,
    cancelAtPeriodEnd: false,
  })
})

// --- B6: Stripe GA4 parity for subscriptions + refunds ---

test('handleInvoicePaymentSucceeded emits one GA4 purchase for subscription_create', async () => {
  let sentEvent: unknown = null

  const invoice = {
    id: 'inv_create_1',
    customer_email: 'person@example.com',
    billing_reason: 'subscription_create',
    amount_paid: 2000,
    currency: 'usd',
    parent: { subscription_details: { subscription: 'sub_123' } },
    lines: { data: [{ quantity: 1, pricing: { price_details: { price: 'price_monthly_20' } } }] },
  } as unknown as Stripe.Invoice

  const mockStripe = {
    subscriptions: {
      retrieve: async (_id: string) => ({ current_period_end: 1710000000 }),
    },
  } as unknown as Stripe

  await handleInvoicePaymentSucceeded(
    mockStripe,
    invoice,
    {
      monthly20: 'price_monthly_20',
      monthly50: 'price_monthly_50',
      creditPack: 'price_credit_pack',
    },
    {
      findUserByEmail: async (email: string) => ({
        id: 'user-1',
        email,
        firebaseUid: 'firebase-uid-1',
      }),
      findUserByFirebaseUid: async () => null,
      findUserByStripeCustomerId: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => false,
      addCredits: async () => {},
      adjustCredits: async () => {},
      sendPurchaseEvent: async (params: unknown) => {
        sentEvent = params
      },
      getLastProcessedChargeRefundTotal: async () => 0,
    } as never,
  )

  assert.deepEqual(sentEvent, {
    firebaseUid: 'firebase-uid-1',
    transactionId: 'inv_create_1',
    valueMinorUnits: 2000,
    currency: 'usd',
    paymentProvider: 'stripe',
    items: [{ item_id: 'monthly_20', item_name: 'monthly_20' }],
  })
})

test('handleInvoicePaymentSucceeded emits one GA4 purchase for subscription_cycle', async () => {
  let sentEvent: unknown = null

  const invoice = {
    id: 'inv_cycle_1',
    customer_email: 'person@example.com',
    billing_reason: 'subscription_cycle',
    amount_paid: 2000,
    currency: 'usd',
    parent: { subscription_details: { subscription: 'sub_123' } },
    lines: { data: [{ quantity: 1, pricing: { price_details: { price: 'price_monthly_20' } } }] },
  } as unknown as Stripe.Invoice

  const mockStripe = {
    subscriptions: {
      retrieve: async (_id: string) => ({ current_period_end: 1710000000 }),
    },
  } as unknown as Stripe

  await handleInvoicePaymentSucceeded(
    mockStripe,
    invoice,
    {
      monthly20: 'price_monthly_20',
      monthly50: 'price_monthly_50',
      creditPack: 'price_credit_pack',
    },
    {
      findUserByEmail: async (email: string) => ({
        id: 'user-1',
        email,
        firebaseUid: 'firebase-uid-1',
      }),
      findUserByFirebaseUid: async () => null,
      findUserByStripeCustomerId: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => true,
      addCredits: async () => {},
      adjustCredits: async () => {},
      sendPurchaseEvent: async (params: unknown) => {
        sentEvent = params
      },
      getLastProcessedChargeRefundTotal: async () => 0,
    } as never,
  )

  assert.deepEqual(sentEvent, {
    firebaseUid: 'firebase-uid-1',
    transactionId: 'inv_cycle_1',
    valueMinorUnits: 2000,
    currency: 'usd',
    paymentProvider: 'stripe',
    items: [{ item_id: 'monthly_20', item_name: 'monthly_20' }],
  })
})

test('handleInvoicePaymentSucceeded skips GA4 purchase when firebaseUid is missing', async () => {
  let called = false

  const invoice = {
    id: 'inv_no_uid',
    customer_email: 'person@example.com',
    billing_reason: 'subscription_create',
    amount_paid: 2000,
    currency: 'usd',
    parent: { subscription_details: { subscription: 'sub_123' } },
    lines: { data: [{ quantity: 1, pricing: { price_details: { price: 'price_monthly_20' } } }] },
  } as unknown as Stripe.Invoice

  const mockStripe = {
    subscriptions: {
      retrieve: async (_id: string) => ({ current_period_end: 1710000000 }),
    },
  } as unknown as Stripe

  await handleInvoicePaymentSucceeded(
    mockStripe,
    invoice,
    {
      monthly20: 'price_monthly_20',
      monthly50: 'price_monthly_50',
      creditPack: 'price_credit_pack',
    },
    {
      findUserByEmail: async (email: string) => ({ id: 'user-1', email }),
      findUserByFirebaseUid: async () => null,
      findUserByStripeCustomerId: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => false,
      addCredits: async () => {},
      adjustCredits: async () => {},
      sendPurchaseEvent: async () => {
        called = true
      },
      getLastProcessedChargeRefundTotal: async () => 0,
    } as never,
  )

  assert.equal(called, false)
})

test('handleInvoicePaymentSucceeded a GA4 emission failure does not throw (isolation)', async () => {
  const invoice = {
    id: 'inv_ga4_fail',
    customer_email: 'person@example.com',
    billing_reason: 'subscription_create',
    amount_paid: 2000,
    currency: 'usd',
    parent: { subscription_details: { subscription: 'sub_123' } },
    lines: { data: [{ quantity: 1, pricing: { price_details: { price: 'price_monthly_20' } } }] },
  } as unknown as Stripe.Invoice

  const mockStripe = {
    subscriptions: {
      retrieve: async (_id: string) => ({ current_period_end: 1710000000 }),
    },
  } as unknown as Stripe

  await handleInvoicePaymentSucceeded(
    mockStripe,
    invoice,
    {
      monthly20: 'price_monthly_20',
      monthly50: 'price_monthly_50',
      creditPack: 'price_credit_pack',
    },
    {
      findUserByEmail: async (email: string) => ({
        id: 'user-1',
        email,
        firebaseUid: 'firebase-uid-1',
      }),
      findUserByFirebaseUid: async () => null,
      findUserByStripeCustomerId: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => false,
      addCredits: async () => {},
      adjustCredits: async () => {},
      sendPurchaseEvent: async () => {
        throw new Error('GA4 down')
      },
      getLastProcessedChargeRefundTotal: async () => 0,
    } as never,
  )
  // Reaching here without throwing proves isolation.
})

test('handleChargeRefunded emits a GA4 refund with the delta value for a credit-pack refund', async () => {
  let sentEvent: unknown = null

  const charge = {
    id: 'ch_refund_1',
    amount: 1000,
    amount_refunded: 200,
    currency: 'usd',
    billing_details: { email: 'user@example.com' },
    invoice: 'in_refund_1',
  } as unknown as Stripe.Charge

  const mockStripe = {
    invoices: {
      retrieve: async () => ({
        parent: { subscription_details: { subscription: null } },
        lines: {
          data: [
            {
              quantity: 1,
              pricing: { price_details: { price: 'price_credit_pack' } },
            },
          ],
        },
      }),
    },
  } as unknown as Stripe

  await handleChargeRefunded(
    mockStripe,
    charge,
    {
      monthly20: 'price_monthly_20',
      monthly50: 'price_monthly_50',
      creditPack: 'price_credit_pack',
    },
    {
      findUserByEmail: async (email: string) => ({
        id: 'user-1',
        email,
        firebaseUid: 'firebase-uid-1',
      }),
      findUserByFirebaseUid: async () => null,
      findUserByStripeCustomerId: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => false,
      addCredits: async () => {},
      adjustCredits: async () => {},
      sendRefundEvent: async (params: unknown) => {
        sentEvent = params
      },
      getLastProcessedChargeRefundTotal: async () => 0,
    } as never,
  )

  assert.deepEqual(sentEvent, {
    firebaseUid: 'firebase-uid-1',
    transactionId: 'ch_refund_1_200',
    valueMinorUnits: 200,
    currency: 'usd',
    paymentProvider: 'stripe',
  })
})

test('handleChargeRefunded emits a GA4 refund for a subscription refund', async () => {
  let sentEvent: unknown = null

  const charge = {
    id: 'ch_refund_sub_1',
    amount: 2000,
    amount_refunded: 2000,
    currency: 'usd',
    billing_details: { email: 'user@example.com' },
    invoice: 'in_refund_sub_1',
  } as unknown as Stripe.Charge

  const mockStripe = {
    invoices: {
      retrieve: async () => ({
        parent: { subscription_details: { subscription: 'sub_1' } },
        lines: { data: [] },
      }),
    },
  } as unknown as Stripe

  await handleChargeRefunded(
    mockStripe,
    charge,
    {
      monthly20: 'price_monthly_20',
      monthly50: 'price_monthly_50',
      creditPack: 'price_credit_pack',
    },
    {
      findUserByEmail: async (email: string) => ({
        id: 'user-1',
        email,
        firebaseUid: 'firebase-uid-1',
      }),
      findUserByFirebaseUid: async () => null,
      findUserByStripeCustomerId: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => false,
      addCredits: async () => {},
      adjustCredits: async () => {},
      sendRefundEvent: async (params: unknown) => {
        sentEvent = params
      },
      getLastProcessedChargeRefundTotal: async () => 0,
    } as never,
  )

  assert.deepEqual(sentEvent, {
    firebaseUid: 'firebase-uid-1',
    transactionId: 'ch_refund_sub_1',
    valueMinorUnits: 2000,
    currency: 'usd',
    paymentProvider: 'stripe',
  })
})

test('handleChargeRefunded does not emit a GA4 refund for an unclassifiable refund', async () => {
  let called = false

  const charge = {
    id: 'ch_refund_unknown',
    amount: 500,
    amount_refunded: 500,
    currency: 'usd',
    billing_details: { email: 'user@example.com' },
    invoice: undefined,
  } as unknown as Stripe.Charge

  await handleChargeRefunded(
    mockStripeNoInvoice(),
    charge,
    {
      monthly20: 'price_monthly_20',
      monthly50: 'price_monthly_50',
      creditPack: 'price_credit_pack',
    },
    {
      findUserByEmail: async (email: string) => ({
        id: 'user-1',
        email,
        firebaseUid: 'firebase-uid-1',
      }),
      findUserByFirebaseUid: async () => null,
      findUserByStripeCustomerId: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => false,
      addCredits: async () => {},
      adjustCredits: async () => {},
      sendRefundEvent: async () => {
        called = true
      },
      getLastProcessedChargeRefundTotal: async () => 0,
    } as never,
  )

  assert.equal(called, false)
})

function mockStripeNoInvoice(): Stripe {
  return {} as unknown as Stripe
}

test('handleChargeRefunded skips GA4 refund when firebaseUid is missing', async () => {
  let called = false

  const charge = {
    id: 'ch_refund_no_uid',
    amount: 2000,
    amount_refunded: 2000,
    currency: 'usd',
    billing_details: { email: 'user@example.com' },
    invoice: 'in_refund_no_uid',
  } as unknown as Stripe.Charge

  const mockStripe = {
    invoices: {
      retrieve: async () => ({
        parent: { subscription_details: { subscription: 'sub_1' } },
        lines: { data: [] },
      }),
    },
  } as unknown as Stripe

  await handleChargeRefunded(
    mockStripe,
    charge,
    {
      monthly20: 'price_monthly_20',
      monthly50: 'price_monthly_50',
      creditPack: 'price_credit_pack',
    },
    {
      findUserByEmail: async (email: string) => ({ id: 'user-1', email }),
      findUserByFirebaseUid: async () => null,
      findUserByStripeCustomerId: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => false,
      addCredits: async () => {},
      adjustCredits: async () => {},
      sendRefundEvent: async () => {
        called = true
      },
      getLastProcessedChargeRefundTotal: async () => 0,
    } as never,
  )

  assert.equal(called, false)
})
