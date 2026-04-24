export type CookieCategory = 'necessary' | 'analytics' | 'marketing' | 'preferences'

export const COOKIE_POLICY_VERSION = 1 as const
export const CONSENT_TTL_MS = 365 * 24 * 60 * 60 * 1000
export const CONSENT_STORAGE_KEY = 'cookie:consent:v1'
export const COOKIE_CATEGORIES: readonly CookieCategory[] = [
  'necessary',
  'analytics',
  'marketing',
  'preferences',
] as const

export interface CookieConsentRecord {
  policyVersion: number
  consentedAt: string
  expiresAt: string
  regionMode: 'opt-in-strict'
  choices: Record<CookieCategory, boolean>
}

export function defaultRejectChoices(): Record<CookieCategory, boolean> {
  return { necessary: true, analytics: false, marketing: false, preferences: false }
}

export function defaultAcceptChoices(): Record<CookieCategory, boolean> {
  return { necessary: true, analytics: true, marketing: true, preferences: true }
}
