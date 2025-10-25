import { useEffect } from 'react'
import { Platform } from 'react-native'
import { initializeGoogleSignIn } from '~/auth/googleSignin.web'

/**
 * Hook to initialize app services on mount
 * - Google Sign-In (web only)
 * - Future: Other platform-specific initializations
 */
export function useInitializeApp() {
  // Initialize Google Sign-In when component mounts
  useEffect(() => {
    if (Platform.OS === 'web') {
      initializeGoogleSignIn().catch(console.error)
    }
  }, [])
}
