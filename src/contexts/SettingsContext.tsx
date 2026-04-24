import React, {
    createContext,
    useContext,
    useState,
    useCallback,
    ReactNode,
} from 'react'
import { Appearance } from 'react-native'
import { Storage } from '~/utilities/kvStorage'
import { setCrashlyticsEnabled } from '~/services/crashlyticsService'
import { useCookieConsent } from '~/components/CookieConsent'
import { SettingKey, settingKey, readBoolSync } from '~/utilities/settingsStorage'

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
    const [settings, setSettings] = useState<Settings>(() => ({
        analytics: readBoolSync('analytics', false),
        darkMode: readBoolSync('darkMode', Appearance.getColorScheme() === 'dark'),
        notifications: readBoolSync('notifications', true),
    }))
    const { canUse } = useCookieConsent()

    const updateSetting = useCallback((key: SettingKey, value: boolean) => {
        // Gate persistence of preference settings on cookie consent
        const requiresPreferencesConsent = key === 'darkMode'
        const shouldPersist = !requiresPreferencesConsent || canUse('preferences')

        if (shouldPersist) {
            try {
                Storage.setItemSync(settingKey(key), value ? '1' : '0')
            } catch (err) {
                console.error(`Failed to persist setting "${key}":`, err)
            }
        }

        // Side-effect: sync Crashlytics enabled state when analytics toggle changes
        if (key === 'analytics') {
            void setCrashlyticsEnabled(value)
        }

        setSettings((prev) => ({ ...prev, [key]: value }))
    }, [canUse])

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
