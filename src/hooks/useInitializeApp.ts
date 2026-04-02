import { useEffect } from 'react'

import { initializeGoogleSignIn } from '~/auth/googleSignin'
import { initializeRevenueCat } from '~/config/revenueCatConfig'
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
      // --- Crashlytics Initialization ---
      try {
        await initializeCrashlytics()
      } catch (error) {
        reportError(error, 'initializeCrashlytics')
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
