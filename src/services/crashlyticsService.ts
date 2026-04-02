import crashlytics from '@react-native-firebase/crashlytics'
import Storage from 'expo-sqlite/kv-store'

const ANALYTICS_KEY = 'setting:analytics'

/**
 * Read the persisted analytics preference and apply it to Crashlytics.
 * Called once at app startup.
 */
export async function initializeCrashlytics(): Promise<void> {
    try {
        const raw = Storage.getItemSync(ANALYTICS_KEY)
        const enabled = raw === '1'
        await crashlytics().setCrashlyticsCollectionEnabled(enabled)
        console.log(`✅ Crashlytics initialized (enabled: ${enabled})`)
    } catch (error) {
        console.error('❌ Error initializing Crashlytics:', error)
        throw error
    }
}

/**
 * Toggle Crashlytics crash reporting in real-time.
 */
export async function setCrashlyticsEnabled(enabled: boolean): Promise<void> {
    try {
        await crashlytics().setCrashlyticsCollectionEnabled(enabled)
    } catch (error) {
        console.error('❌ Error toggling Crashlytics:', error)
    }
}

/**
 * Set the user ID for crash attribution. Pass null on sign-out.
 */
export async function setCrashlyticsUserId(userId: string | null): Promise<void> {
    try {
        await crashlytics().setUserId(userId ?? '')
    } catch (error) {
        console.error('❌ Error setting Crashlytics user ID:', error)
    }
}

/**
 * Record an error to Crashlytics with optional context attribute.
 */
export async function logCrashlyticsError(error: Error, context?: string): Promise<void> {
    try {
        if (context) {
            await crashlytics().setAttribute('context', context)
        }
        await crashlytics().recordError(error)
    } catch (err) {
        console.error('❌ Error recording Crashlytics error:', err)
    }
}
