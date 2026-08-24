import { createHmac } from 'node:crypto'

/** Throwaway constants — never real secrets. */
export const INT_STRIPE_SECRET = 'whsec_int_test_123'
export const INT_RC_SECRET = 'rc_int_secret_123'

export const INT_PRICE_IDS = {
  monthly20: 'price_int_monthly_20',
  monthly50: 'price_int_monthly_50',
  creditPack: 'price_int_credit_pack',
} as const

/**
 * Genuine Stripe signature over the exact wire bytes:
 * `t=<unixSeconds>,v1=HMAC_SHA256(secret, "<t>.<payload>")`.
 * Same wire format as the helper introduced in stripeWebhook.test.ts.
 */
export const signStripeHeader = (
  payload: Buffer | string,
  secret: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): string => {
  const bytes = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload
  const timestamp = String(timestampSeconds)
  const mac = createHmac('sha256', secret).update(`${timestamp}.`).update(bytes).digest('hex')
  return `t=${timestamp},v1=${mac}`
}

/** fetch() options for one genuinely-signed Stripe webhook delivery. */
export const signedStripePost = (body: string): RequestInit => ({
  method: 'POST',
  headers: { 'stripe-signature': signStripeHeader(body, INT_STRIPE_SECRET) },
  body,
})

/** RevenueCat Authorization header in either accepted form. */
export const rcAuthHeaders = (form: 'bearer' | 'bare'): Record<string, string> =>
  form === 'bearer'
    ? { authorization: `Bearer ${INT_RC_SECRET}` }
    : { authorization: INT_RC_SECRET }
