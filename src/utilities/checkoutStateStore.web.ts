export const CHECKOUT_SCHEMA_VERSION = 1 as const
export const CHECKOUT_TTL_MS = 15 * 60 * 1000
export const CHECKOUT_STATUSES = ['pending', 'succeeded', 'cancelled', 'expired'] as const

export type CheckoutStatus = 'pending' | 'succeeded' | 'cancelled' | 'expired'

export type CheckoutStoreMap = Record<string, CheckoutAttemptRecord>

export interface CheckoutAttemptRecord {
  attemptId: string
  productType: string
  status: CheckoutStatus
  at: string
  sourceTabId: string
  schemaVersion: number
}

const inMemoryStoreByUid: Record<string, CheckoutStoreMap> = {}

function hasWindow(): boolean {
  return typeof window !== 'undefined'
}

function getStorage(): Storage | null {
  try {
    const storageCandidate =
      (globalThis as { localStorage?: Storage }).localStorage ??
      (hasWindow() ? window.localStorage : undefined)

    return storageCandidate ?? null
  } catch {
    return null
  }
}

export function isCheckoutStatus(value: unknown): value is CheckoutStatus {
  return typeof value === 'string' && CHECKOUT_STATUSES.includes(value as CheckoutStatus)
}

export function hasFiniteTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

export function getCheckoutStoreKey(uid: string): string {
  return `checkout:attempts:${uid}`
}

function isRecord(value: unknown): value is CheckoutAttemptRecord {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<CheckoutAttemptRecord>

  return (
    typeof candidate.attemptId === 'string' &&
    typeof candidate.productType === 'string' &&
    isCheckoutStatus(candidate.status) &&
    hasFiniteTimestamp(candidate.at) &&
    typeof candidate.sourceTabId === 'string' &&
    typeof candidate.schemaVersion === 'number'
  )
}

function isKnownSchemaVersion(record: CheckoutAttemptRecord): boolean {
  return record.schemaVersion === CHECKOUT_SCHEMA_VERSION
}

function parseStore(value: string | null): CheckoutStoreMap {
  if (!value) {
    return {}
  }

  try {
    const parsed = JSON.parse(value) as unknown

    if (!parsed || typeof parsed !== 'object') {
      return {}
    }

    const result: CheckoutStoreMap = {}

    for (const [attemptId, record] of Object.entries(parsed)) {
      if (isRecord(record) && isKnownSchemaVersion(record) && record.attemptId === attemptId) {
        result[attemptId] = record
      }
    }

    return result
  } catch {
    return {}
  }
}

function writeStore(uid: string, map: CheckoutStoreMap): void {
  const storage = getStorage()

  if (!storage) {
    inMemoryStoreByUid[uid] = { ...map }
    return
  }

  try {
    storage.setItem(getCheckoutStoreKey(uid), JSON.stringify(map))
  } catch {
    // Ignore storage write failures to keep callers resilient in restricted environments.
  }
}

function toTimestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function shouldApplyIncoming(existing: CheckoutAttemptRecord, incoming: CheckoutAttemptRecord): boolean {
  const existingAt = toTimestamp(existing.at)
  const incomingAt = toTimestamp(incoming.at)

  if (incomingAt < existingAt) {
    return false
  }

  if (incomingAt > existingAt) {
    return true
  }

  if (incoming.sourceTabId === existing.sourceTabId) {
    return true
  }

  return incoming.sourceTabId > existing.sourceTabId
}

export function readCheckoutAttempts(uid: string): CheckoutStoreMap {
  const storage = getStorage()

  if (!storage) {
    return { ...(inMemoryStoreByUid[uid] ?? {}) }
  }

  try {
    return parseStore(storage.getItem(getCheckoutStoreKey(uid)))
  } catch {
    return {}
  }
}

export function upsertCheckoutAttempt(
  uid: string,
  incoming: CheckoutAttemptRecord,
): { applied: boolean; record?: CheckoutAttemptRecord } {
  if (!isRecord(incoming) || !isKnownSchemaVersion(incoming)) {
    return { applied: false }
  }

  const attempts = readCheckoutAttempts(uid)
  const existing = attempts[incoming.attemptId]

  if (existing && !shouldApplyIncoming(existing, incoming)) {
    return { applied: false, record: existing }
  }

  attempts[incoming.attemptId] = { ...incoming }
  writeStore(uid, attempts)

  return { applied: true, record: attempts[incoming.attemptId] }
}

export function expireStalePendingAttempts(
  uid: string,
  nowMs: number = Date.now(),
  sourceTabId = 'stale-cleaner',
): CheckoutAttemptRecord[] {
  const attempts = readCheckoutAttempts(uid)
  const expired: CheckoutAttemptRecord[] = []

  for (const [attemptId, record] of Object.entries(attempts)) {
    if (record.status !== 'pending') {
      continue
    }

    if (nowMs - toTimestamp(record.at) <= CHECKOUT_TTL_MS) {
      continue
    }

    const expiredRecord: CheckoutAttemptRecord = {
      ...record,
      attemptId,
      status: 'expired',
      at: new Date(nowMs).toISOString(),
      sourceTabId,
      schemaVersion: CHECKOUT_SCHEMA_VERSION,
    }

    attempts[attemptId] = expiredRecord
    expired.push(expiredRecord)
  }

  if (expired.length > 0) {
    writeStore(uid, attempts)
  }

  return expired
}

export function clearCheckoutAttempts(uid: string): void {
  delete inMemoryStoreByUid[uid]

  const storage = getStorage()

  if (!storage) {
    return
  }

  try {
    storage.removeItem(getCheckoutStoreKey(uid))
  } catch {
    // Ignore storage failures.
  }
}

export function clearPendingCheckoutAttempts(uid: string): CheckoutAttemptRecord[] {
  const attempts = readCheckoutAttempts(uid)
  const cleared: CheckoutAttemptRecord[] = []

  for (const [attemptId, record] of Object.entries(attempts)) {
    if (record.status !== 'pending') {
      continue
    }

    cleared.push({ ...record, attemptId })
    delete attempts[attemptId]
  }

  if (cleared.length > 0) {
    writeStore(uid, attempts)
  }

  return cleared
}
