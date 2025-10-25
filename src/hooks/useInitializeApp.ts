import { useEffect } from 'react'
import { initializeGoogleSignIn } from '~/auth/googleSignin'

/**
 * Hook to initialize app services on mount
 * - Google Sign-In
 * - Future: Other platform-specific initializations
 */
export function useInitializeApp() {
  // Initialize Google Sign-In when component mounts
  useEffect(() => {
    initializeGoogleSignIn()
  }, [])
}
