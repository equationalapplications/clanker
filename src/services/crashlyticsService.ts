import {
  getCrashlytics,
  setCrashlyticsCollectionEnabled as setCrashlyticsCollectionEnabledMod,
  setUserId as setUserIdMod,
  setAttribute as setAttributeMod,
  recordError as recordErrorMod,
  deleteUnsentReports as deleteUnsentReportsMod,
} from '@react-native-firebase/crashlytics'
import { resolveAnalyticsConsent } from '~/utilities/settingsStorage'

/**
 * Apply the persisted analytics consent for the signed-in `uid` to Crashlytics.
 * Called once at app startup.
 *
 * Platform limits (RNFB 26/27): `setCrashlyticsCollectionEnabled` only writes RNFB's pref; the
 * SDK reads it once per process. JS-originated reports (recordError, setUserId, setAttribute,
 * JS fatals) honour it immediately, but native capture keeps running for the rest of the
 * process and its reports upload at a later launch. When consent is inactive we therefore
 * delete any queued reports here, which works whenever the SDK launched disabled. Known
 * residual on iOS: FIRCrashlytics decides "upload at startup" from its own sticky flag before
 * RNFB rewrites it, so a native crash after sign-out (same process) can still upload at the
 * next launch, without a user id. Closing that needs a native call to the SDK.
 */
export async function initializeCrashlytics(uid: string | null = null): Promise<void> {
  try {
    const enabled = resolveAnalyticsConsent(uid)
    const instance = getCrashlytics()
    await setCrashlyticsCollectionEnabledMod(instance, enabled)
    if (!enabled) {
      try {
        await deleteUnsentReportsMod(instance)
      } catch (error) {
        console.error('❌ Error deleting unsent Crashlytics reports:', error)
      }
    }
    console.log(`✅ Crashlytics initialized (enabled: ${enabled})`)
  } catch (error) {
    console.error('❌ Error initializing Crashlytics:', error)
  }
}

/**
 * Toggle Crashlytics crash reporting in real-time.
 */
export async function setCrashlyticsEnabled(enabled: boolean): Promise<void> {
  try {
    await setCrashlyticsCollectionEnabledMod(getCrashlytics(), enabled)
  } catch (error) {
    console.error('❌ Error toggling Crashlytics:', error)
  }
}

/**
 * Set the user ID for crash attribution. Pass null on sign-out.
 */
export async function setCrashlyticsUserId(userId: string | null): Promise<void> {
  try {
    await setUserIdMod(getCrashlytics(), userId ?? '')
  } catch (error) {
    console.error('❌ Error setting Crashlytics user ID:', error)
  }
}

/** Blank the `context` attribute so it does not carry over to another account. */
export async function clearCrashlyticsContext(): Promise<void> {
  try {
    await setAttributeMod(getCrashlytics(), 'context', '')
  } catch (error) {
    console.error('❌ Error clearing Crashlytics context:', error)
  }
}

/**
 * Record an error to Crashlytics with optional context attribute.
 */
export async function logCrashlyticsError(error: Error, context?: string): Promise<void> {
  try {
    const instance = getCrashlytics()
    if (context) {
      await setAttributeMod(instance, 'context', context)
    }
    recordErrorMod(instance, error)
  } catch (err) {
    console.error('❌ Error recording Crashlytics error:', err)
  }
}
