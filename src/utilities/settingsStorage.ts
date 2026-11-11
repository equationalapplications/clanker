import { Storage } from '~/utilities/kvStorage'

export type SettingKey = 'analytics' | 'darkMode' | 'notifications'

export const SETTING_KEYS: SettingKey[] = ['analytics', 'darkMode', 'notifications']

export function settingKey(key: SettingKey): string {
  return `setting:${key}`
}

export function readBoolSync(key: SettingKey, defaultValue: boolean): boolean {
  try {
    const raw = Storage.getItemSync(settingKey(key))
    if (raw === null || raw === '') return defaultValue
    return raw === '1'
  } catch {
    return defaultValue
  }
}

/** True once the user has made an explicit choice for `key` (cleared values count as unset). */
export function hasStoredSetting(key: SettingKey): boolean {
  try {
    const raw = Storage.getItemSync(settingKey(key))
    return raw !== null && raw !== ''
  } catch {
    // Unreadable storage: treat as decided so a broken store cannot re-prompt every launch.
    return true
  }
}

/** Blank one setting so it reads as unset (see `hasStoredSetting`). Best-effort. */
export function clearSetting(key: SettingKey): void {
  try {
    Storage.setItemSync(settingKey(key), '')
  } catch {
    // best-effort
  }
}

/**
 * Uid of the account that made the stored analytics choice. Deliberately NOT a `SettingKey`:
 * that union drives `Record<SettingKey, boolean>` in SettingsContext, and this is not a toggle.
 */
export const ANALYTICS_OWNER_KEY = 'setting:analyticsOwner'

/**
 * Whether native analytics/crash collection may run for `uid`, reconciling storage on the way.
 *
 * Consent belongs to the account that gave it: it is active only when the stored value is '1'
 * AND the stored owner is `uid`.
 * - `uid` null (no one signed in): inactive, storage untouched so the owner resumes later
 *   without being re-asked (lost session, failed bootstrap).
 * - owner is a different account: inactive, choice blanked so this account is asked.
 * - no owner (stored before owners existed): a '0' is adopted by `uid` (a decline needs no
 *   proof of ownership); a '1' is blanked and re-asked (a grant does).
 * - unreadable storage: inactive, nothing written.
 */
export function resolveAnalyticsConsent(uid: string | null): boolean {
  let raw: string | null
  let owner: string | null
  try {
    raw = Storage.getItemSync(settingKey('analytics'))
    owner = Storage.getItemSync(ANALYTICS_OWNER_KEY)
  } catch {
    return false
  }
  if (uid === null) return false
  if (raw === null || raw === '') return false
  if (owner === uid) return raw === '1'
  try {
    if (owner) {
      Storage.setItemSync(settingKey('analytics'), '')
      Storage.setItemSync(ANALYTICS_OWNER_KEY, '')
    } else if (raw === '1') {
      Storage.setItemSync(settingKey('analytics'), '')
    } else {
      Storage.setItemSync(ANALYTICS_OWNER_KEY, uid)
    }
  } catch {
    // best-effort; still inactive
  }
  return false
}

/**
 * Persist an analytics choice for `uid` (or ownerless when null). The value is written before
 * the owner, so a torn write leaves an ownerless value, which fails toward a re-prompt.
 */
export function writeAnalyticsChoice(allow: boolean, uid: string | null): void {
  try {
    Storage.setItemSync(settingKey('analytics'), allow ? '1' : '0')
    Storage.setItemSync(ANALYTICS_OWNER_KEY, uid ?? '')
  } catch (err) {
    console.error('Failed to persist analytics choice:', err)
  }
}

/** Blank the analytics choice and its owner. Best-effort. */
export function clearAnalyticsConsent(): void {
  clearSetting('analytics')
  try {
    Storage.setItemSync(ANALYTICS_OWNER_KEY, '')
  } catch {
    // best-effort
  }
}

export function clearSettings(): void {
  for (const key of SETTING_KEYS) {
    clearSetting(key)
  }
  clearAnalyticsConsent()
}
