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
      // Only read the debug token in dev builds so it cannot leak into production
      const debugToken = __DEV__ ? process.env.EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN : undefined

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
              '⚠️ EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN is not set. Skipping App Check activation in debug mode.',
            )
          } else {
            appCheck().setTokenAutoRefreshEnabled(true)
            await appCheck().activate(debugToken, true)
            console.log('✅ Firebase App Check activated in DEBUG mode (Native).')
          }
        } else {
          await appCheck().activate(checkProvider.provider, true)
          console.log('✅ Firebase App Check activated in PRODUCTION mode (Native).')
        }
      } catch (error) {
        console.error('❌ Error activating Firebase App Check (Native):', error)
      }

      // --- Google Sign-In Initialization ---
      try {
        await initializeGoogleSignIn()
      } catch (error) {
        console.error('❌ Error initializing Google Sign-In (Native):', error)
      }
    }

    initializeAppServices()
  }, [])
}
