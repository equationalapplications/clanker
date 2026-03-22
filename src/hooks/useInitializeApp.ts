import { useEffect } from 'react'
import { Platform } from 'react-native'
import appCheck from '@react-native-firebase/app-check'

import { initializeGoogleSignIn } from '~/auth/googleSignin'

/**
 * Hook to initialize app services on mount (native platforms)
 * - Firebase App Check (Android/iOS only)
 * - Google Sign-In
 */
export function useInitializeApp() {
  useEffect(() => {
    const initializeAppServices = async () => {
      // --- Firebase App Check Initialization ---
      const debugToken = process.env.EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN

      const checkProvider = Platform.select({
        android: {
          provider: 'playIntegrity',
          debugToken,
        },
        ios: {
          provider: 'appAttest',
          debugToken,
        },
      })

      if (!checkProvider) {
        console.error('App Check is not supported on this platform.')
        return
      }

      try {
        if (__DEV__) {
          if (!debugToken) {
            console.warn(
              '⚠️ EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN is not set. App Check debug mode may not work.',
            )
          }
          appCheck().setTokenAutoRefreshEnabled(true)
          await appCheck().activate(checkProvider.debugToken ?? '', true)
          console.log('✅ Firebase App Check activated in DEBUG mode (Native).')
        } else {
          await appCheck().activate(checkProvider.provider, true)
          console.log('✅ Firebase App Check activated in PRODUCTION mode (Native).')
        }
      } catch (error) {
        console.error('❌ Error activating Firebase App Check (Native):', error)
      }

      // --- Google Sign-In Initialization ---
      initializeGoogleSignIn()
    }

    initializeAppServices()
  }, [])
}
