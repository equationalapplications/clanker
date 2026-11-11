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

export function clearSettings(): void {
  for (const key of SETTING_KEYS) {
    clearSetting(key)
  }
}
