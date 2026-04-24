import {
  CONSENT_STORAGE_KEY,
  COOKIE_POLICY_VERSION,
  CookieConsentRecord,
} from './cookieConsentTypes'

function hasWindow(): boolean {
  return typeof window !== 'undefined'
}

function getStorage(): Storage | null {
  try {
    const candidate =
      (globalThis as { localStorage?: Storage }).localStorage ??
      (hasWindow() ? window.localStorage : undefined)
    return candidate ?? null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is CookieConsentRecord {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<CookieConsentRecord>
  if (v.policyVersion !== COOKIE_POLICY_VERSION) return false
  if (typeof v.consentedAt !== 'string' || Number.isNaN(Date.parse(v.consentedAt))) return false
  if (typeof v.expiresAt !== 'string' || Number.isNaN(Date.parse(v.expiresAt))) return false
  if (v.regionMode !== 'opt-in-strict') return false
  const c = v.choices
  if (!c || typeof c !== 'object') return false
  return (
    c.necessary === true &&
    typeof c.analytics === 'boolean' &&
    typeof c.marketing === 'boolean' &&
    typeof c.preferences === 'boolean'
  )
}

export function readConsent(now: number = Date.now()): CookieConsentRecord | null {
  const storage = getStorage()
  if (!storage) return null
  try {
    const raw = storage.getItem(CONSENT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) return null
    if (Date.parse(parsed.expiresAt) <= now) return null
    return parsed
  } catch {
    return null
  }
}

export function writeConsent(record: CookieConsentRecord): void {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record))
  } catch {
    // ignore quota / private-mode failures
  }
}

export function clearConsent(): void {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.removeItem(CONSENT_STORAGE_KEY)
  } catch {
    // ignore
  }
}
