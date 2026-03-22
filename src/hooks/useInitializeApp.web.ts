import { useEffect } from 'react'

import { initializeGoogleSignIn } from '~/auth/googleSignin'

/**
 * Hook to initialize app services on mount (web platform)
 * - Google Sign-In (async on web)
 * - App Check for web is handled in firebaseConfig.web.ts via ReCaptchaEnterprise
 */
export function useInitializeApp() {
  useEffect(() => {
    const initializeAppServices = async () => {
      try {
        await initializeGoogleSignIn()
        console.log('✅ Google Sign-In initialized (Web).')
      } catch (error) {
        console.error('❌ Error initializing Google Sign-In (Web):', error)
      }
    }

    initializeAppServices()
  }, [])
}
