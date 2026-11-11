import { useEffect } from 'react'

import { initializeGoogleSignIn } from '~/auth/googleSignin'
import { getCurrentUser } from '~/config/firebaseConfig'
import { initializeRevenueCat } from '~/config/revenueCatConfig'
import { initializeAnalytics } from '~/services/analyticsService'
import { initializeCrashlytics } from '~/services/crashlyticsService'
import { reportError } from '~/utilities/reportError'

/**
 * Hook to initialize app services on mount (native platforms)
 * - Google Sign-In
 * - RevenueCat
 *
 * Note: App Check is initialized at module load time in firebaseConfig.ts
 * (via appCheckReady) so it's ready before any callable functions run.
 */
export function useInitializeApp() {
  useEffect(() => {
    const initializeAppServices = async () => {
      // Consent is bound to the account that gave it; the restored user is known synchronously.
      const uid = getCurrentUser()?.uid ?? null

      // --- Crashlytics Initialization ---
      try {
        await initializeCrashlytics(uid)
      } catch (error) {
        reportError(error, 'initializeCrashlytics')
      }

      // --- Analytics Initialization (native settings toggle; web uses cookie consent) ---
      try {
        await initializeAnalytics(uid)
      } catch (error) {
        reportError(error, 'initializeAnalytics')
      }

      // --- Google Sign-In Initialization ---
      try {
        await initializeGoogleSignIn()
      } catch (error) {
        reportError(error, 'initializeGoogleSignIn')
      }

      // --- RevenueCat Initialization (native only) ---
      try {
        await initializeRevenueCat()
      } catch (error) {
        reportError(error, 'initializeRevenueCat')
      }
    }

    initializeAppServices()
  }, [])
}
