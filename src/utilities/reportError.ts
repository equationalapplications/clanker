import { isAnalyticsConsentActive } from '~/services/analyticsConsent'
import { logCrashlyticsError } from '~/services/crashlyticsService'

/**
 * Report an error to the console and, if the signed-in account consented, to Crashlytics.
 * Safe to call from any context — does not require React or a hook.
 */
export function reportError(error: unknown, context?: string): void {
  console.error(context ? `❌ [${context}]` : '❌', error)

  try {
    if (isAnalyticsConsentActive()) {
      const err = error instanceof Error ? error : new Error(String(error))
      void logCrashlyticsError(err, context)
    }
  } catch {
    // Never let reporting throw
  }
}
