import React, {
    createContext,
    useContext,
    useState,
    useCallback,
    ReactNode,
} from 'react'
import Storage from 'expo-sqlite/kv-store'
import { setCrashlyticsEnabled } from '~/services/crashlyticsService'

// Storage key helpers
function settingKey(key: string): string {
    return `setting:${key}`
}

function readBoolSync(key: string, defaultValue: boolean): boolean {
    try {
        const raw = Storage.getItemSync(settingKey(key))
        if (raw === null) return defaultValue
        return raw === '1'
    } catch {
        return defaultValue
    }
}

// Settings shape
interface Settings {
    analytics: boolean
    darkMode: boolean
    notifications: boolean
}

type SettingKey = keyof Settings

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
        darkMode: readBoolSync('darkMode', true),
        notifications: readBoolSync('notifications', true),
    }))

    const updateSetting = useCallback((key: SettingKey, value: boolean) => {
        // Persist synchronously so non-React code can read it immediately
        try {
            Storage.setItemSync(settingKey(key), value ? '1' : '0')
        } catch (err) {
            console.error(`Failed to persist setting "${key}":`, err)
        }

        // Side-effect: sync Crashlytics enabled state when analytics toggle changes
        if (key === 'analytics') {
            void setCrashlyticsEnabled(value)
        }

        setSettings((prev) => ({ ...prev, [key]: value }))
    }, [])

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
