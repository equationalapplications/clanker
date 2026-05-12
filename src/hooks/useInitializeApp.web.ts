import { useEffect } from 'react'

import { installGoogleIdentityConsoleFilter } from '~/utilities/devConsoleFilters.web'

/**
 * Hook to initialize app services on mount (web platform).
 * - Installs the GIS console filter so GIS dev logs do not trigger Expo LogBox modals.
 * - App Check for web is handled in firebaseConfig.web.ts via ReCaptchaEnterprise.
 * - Google Sign-In script load + FedCM init runs in GoogleSignInButton.web on mount.
 */
export function useInitializeApp() {
  useEffect(() => {
    installGoogleIdentityConsoleFilter()
  }, [])
}
