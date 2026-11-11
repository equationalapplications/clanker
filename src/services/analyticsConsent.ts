import { Platform } from 'react-native'

import { setAnalyticsEnabled, setUserId } from '~/services/analyticsService'
import {
  clearCrashlyticsContext,
  setCrashlyticsEnabled,
  setCrashlyticsUserId,
} from '~/services/crashlyticsService'
import {
  ANALYTICS_OWNER_KEY,
  clearAnalyticsConsent,
  resolveAnalyticsConsent,
  settingKey,
  writeAnalyticsChoice,
} from '~/utilities/settingsStorage'
import { Storage } from '~/utilities/kvStorage'

/**
 * Native analytics + Crashlytics consent, bound to the signed-in account.
 *
 * Invariant: native collection is on iff `setting:analytics === '1'` AND
 * `setting:analyticsOwner === <signed-in uid>` (see `resolveAnalyticsConsent`).
 *
 * - `reconcileAnalyticsConsent(uid)` runs synchronously whenever the signed-in user is known
 *   (top-level USER_FOUND, before the drawer and its consent prompt mount) and with `null` on
 *   entering signedOut (suspend without forgetting the owner's choice).
 * - `resetAnalyticsConsent()` forgets the choice (explicit sign-out, server revocation).
 * - `setAnalyticsChoice(allow)` records a choice for the current subject (prompt, Settings).
 *
 * Web is a no-op: the cookie-consent banner owns this there.
 */

let subjectUid: string | null = null
const listeners = new Set<() => void>()

function snapshot(): string {
  try {
    return `${Storage.getItemSync(settingKey('analytics'))}|${Storage.getItemSync(ANALYTICS_OWNER_KEY)}`
  } catch {
    return ''
  }
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch (err) {
      console.error('analytics consent listener failed:', err)
    }
  }
}

async function applyOff(): Promise<void> {
  // Ids and attributes first: once the Crashlytics pref is false, RNFB skips native setUserId,
  // which would leave the previous account's uid attached.
  await Promise.all([setCrashlyticsUserId(null), setUserId(null), clearCrashlyticsContext()])
  await Promise.all([setCrashlyticsEnabled(false), setAnalyticsEnabled(false)])
}

async function applyOn(uid: string): Promise<void> {
  await Promise.all([setCrashlyticsEnabled(true), setAnalyticsEnabled(true)])
  await Promise.all([setCrashlyticsUserId(uid), setUserId(uid)])
}

// SDK updates are multi-step and async; run them strictly in order so an earlier "off" can
// never finish after a later "on" (e.g. reconcile on USER_FOUND, then the prompt's "Share").
let applyChain: Promise<void> = Promise.resolve()

function apply(active: boolean): Promise<void> {
  const uid = subjectUid
  applyChain = applyChain
    .then(() => (active && uid ? applyOn(uid) : applyOff()))
    .catch((err) => console.error('❌ Error applying analytics consent:', err))
  return applyChain
}

/** True when collection may run now: consent was granted by the signed-in account. */
export function isAnalyticsConsentActive(): boolean {
  if (Platform.OS === 'web' || subjectUid === null) return false
  try {
    return (
      Storage.getItemSync(settingKey('analytics')) === '1' &&
      Storage.getItemSync(ANALYTICS_OWNER_KEY) === subjectUid
    )
  } catch {
    return false
  }
}

export function reconcileAnalyticsConsent(uid: string | null): void {
  if (Platform.OS === 'web') return
  subjectUid = uid
  const before = snapshot()
  const active = resolveAnalyticsConsent(uid)
  void apply(active)
  if (snapshot() !== before) notify()
}

export function setAnalyticsChoice(allow: boolean): void {
  if (Platform.OS === 'web') return
  writeAnalyticsChoice(allow, subjectUid)
  void apply(allow && subjectUid !== null)
  notify()
}

export async function resetAnalyticsConsent(): Promise<void> {
  if (Platform.OS === 'web') return
  clearAnalyticsConsent()
  notify()
  await apply(false)
}

export function subscribeAnalyticsConsent(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** @internal Resets module state between unit tests. */
export function __resetAnalyticsConsentForTests(): void {
  subjectUid = null
  listeners.clear()
  applyChain = Promise.resolve()
}
