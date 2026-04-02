import { useEffect } from 'react'

import { initializeGoogleSignIn } from '~/auth/googleSignin'
import { initializeRevenueCat } from '~/config/revenueCatConfig'

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
      // --- Google Sign-In Initialization ---
      try {
        await initializeGoogleSignIn()
      } catch (error) {
        console.error('❌ Error initializing Google Sign-In (Native):', error)
      }

      // --- RevenueCat Initialization (native only) ---
      try {
        await initializeRevenueCat()
      } catch (error) {
        console.error('❌ Error initializing RevenueCat:', error)
      }
    }

    initializeAppServices()
  }, [])
}
