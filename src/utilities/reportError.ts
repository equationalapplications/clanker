import Storage from 'expo-sqlite/kv-store'
import { logCrashlyticsError } from '~/services/crashlyticsService'

const ANALYTICS_KEY = 'setting:analytics'

/**
 * Report an error to the console and, if analytics is enabled, to Crashlytics.
 * Safe to call from any context — does not require React or a hook.
 */
export function reportError(error: unknown, context?: string): void {
    console.error(context ? `❌ [${context}]` : '❌', error)

    try {
        const analyticsEnabled = Storage.getItemSync(ANALYTICS_KEY) === '1'
        if (analyticsEnabled) {
            const err = error instanceof Error ? error : new Error(String(error))
            void logCrashlyticsError(err, context)
        }
    } catch {
        // Storage read failed — silently skip Crashlytics reporting
    }
}
