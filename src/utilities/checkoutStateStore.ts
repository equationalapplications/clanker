export const CHECKOUT_SCHEMA_VERSION = 1 as const
export const CHECKOUT_TTL_MS = 15 * 60 * 1000
export const CHECKOUT_STATUSES = ['pending', 'succeeded', 'cancelled', 'expired'] as const

export type CheckoutStatus = 'pending' | 'succeeded' | 'cancelled' | 'expired'

export interface CheckoutAttemptRecord {
  attemptId: string
  productType: string
  status: CheckoutStatus
  at: string
  sourceTabId: string
  schemaVersion: number
}

export type CheckoutStoreMap = Record<string, CheckoutAttemptRecord>

export function isCheckoutStatus(value: unknown): value is CheckoutStatus {
  return typeof value === 'string' && CHECKOUT_STATUSES.includes(value as CheckoutStatus)
}

export function hasFiniteTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

export function getCheckoutStoreKey(uid: string): string {
  return `checkout:attempts:${uid}`
}

export function readCheckoutAttempts(_uid: string): CheckoutStoreMap {
  return {}
}

export function upsertCheckoutAttempt(
  _uid: string,
  _incoming: CheckoutAttemptRecord,
): { applied: boolean; record?: CheckoutAttemptRecord } {
  return { applied: false }
}

export function expireStalePendingAttempts(
  _uid: string,
  _nowMs: number = Date.now(),
  _sourceTabId = 'stale-cleaner',
): CheckoutAttemptRecord[] {
  return []
}

export function clearCheckoutAttempts(_uid: string): void {
  // No-op on native.
}

export function clearPendingCheckoutAttempts(_uid: string): CheckoutAttemptRecord[] {
  return []
}
