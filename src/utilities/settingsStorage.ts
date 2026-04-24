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

export function clearSettings(): void {
  for (const key of SETTING_KEYS) {
    try {
      Storage.setItemSync(settingKey(key), '')
      // removeItem is async; wipe synchronously by writing empty string then remove async
      void Storage.removeItem(settingKey(key))
    } catch {
      // best-effort
    }
  }
}
