import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from 'react'
import { Appearance, Platform } from 'react-native'
import { Storage } from '~/utilities/kvStorage'
import { setAnalyticsEnabled } from '~/services/analyticsService'
import { setCrashlyticsEnabled } from '~/services/crashlyticsService'
import { setAnalyticsChoice, subscribeAnalyticsConsent } from '~/services/analyticsConsent'
import { useCookieConsent } from '~/components/CookieConsent'
import { SettingKey, settingKey, readBoolSync } from '~/utilities/settingsStorage'
import { readConsent } from '~/utilities/cookieConsentStorage.web'

export { clearSettings } from '~/utilities/settingsStorage'

// Settings shape — derived from SettingKey so the two can't drift
type Settings = Record<SettingKey, boolean>

interface SettingsContextType {
  settings: Settings
  updateSetting: (key: SettingKey, value: boolean) => void
}

const SettingsContext = createContext<SettingsContextType | null>(null)

interface SettingsProviderProps {
  children: ReactNode
}

export function SettingsProvider({ children }: SettingsProviderProps) {
  const [settings, setSettings] = useState<Settings>(() => {
    const systemDark = Appearance.getColorScheme() === 'dark'
    // On web, only read the persisted darkMode value if preferences consent has been
    // granted; otherwise fall back to the system colour scheme to avoid reading
    // preference storage without consent.
    const hasPreferencesConsent =
      Platform.OS !== 'web' || readConsent()?.choices?.preferences === true
    return {
      analytics: readBoolSync('analytics', false),
      darkMode: hasPreferencesConsent ? readBoolSync('darkMode', systemDark) : systemDark,
      notifications: readBoolSync('notifications', true),
    }
  })
  const { canUse } = useCookieConsent()

  // Native consent can change outside this provider (account reconcile, sign-out reset), so
  // keep the toggle in sync. The immediate sync() picks up changes made by child effects
  // (startup init, auth actor) that ran before this effect subscribed.
  useEffect(() => {
    if (Platform.OS === 'web') return
    const sync = () =>
      setSettings((prev) => {
        const analytics = readBoolSync('analytics', false)
        return prev.analytics === analytics ? prev : { ...prev, analytics }
      })
    sync()
    return subscribeAnalyticsConsent(sync)
  }, [])

  const updateSetting = useCallback(
    (key: SettingKey, value: boolean) => {
      // Gate persistence of darkMode on cookie consent, but only on web.
      // On native, cookie consent is not available (no localStorage), so always persist.
      const requiresPreferencesConsent = key === 'darkMode' && Platform.OS === 'web'
      const shouldPersist = !requiresPreferencesConsent || canUse('preferences')

      // Native analytics consent is owned by analyticsConsent (bound to the signed-in uid).
      if (key === 'analytics' && Platform.OS !== 'web') {
        setAnalyticsChoice(value)
        setSettings((prev) => ({ ...prev, analytics: value }))
        return
      }

      if (shouldPersist) {
        try {
          Storage.setItemSync(settingKey(key), value ? '1' : '0')
        } catch (err) {
          console.error(`Failed to persist setting "${key}":`, err)
        }
      }

      // Side-effect: sync Crashlytics and Analytics when analytics toggle changes
      if (key === 'analytics') {
        void setCrashlyticsEnabled(value)
        void setAnalyticsEnabled(value)
      }

      setSettings((prev) => ({ ...prev, [key]: value }))
    },
    [canUse],
  )

  return (
    <SettingsContext.Provider value={{ settings, updateSetting }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextType {
  const context = useContext(SettingsContext)
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
}
