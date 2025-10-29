import { useEffect } from 'react';
import { Platform } from 'react-native';
import appCheck from '@react-native-firebase/app-check';

import { initializeGoogleSignIn } from '~/auth/googleSignin';

/**
 * Hook to initialize app services on mount
 * - Firebase App Check
 * - Google Sign-In
 * - Future: Other platform-specific initializations
 */
export function useInitializeApp() {
  useEffect(() => {
    const initializeAppServices = async () => {
      // --- Firebase App Check Initialization (Native Only) ---
      if (Platform.OS !== 'web') {
        // Get the appropriate provider and debug token for the current platform.
        // IMPORTANT: Replace 'YOUR_DEBUG_TOKEN' with the actual debug tokens you generate.
        const checkProvider = Platform.select({
          android: {
            provider: 'playIntegrity',
            debugToken: 'YOUR_DEBUG_TOKEN', // For emulators/simulators
          },
          ios: {
            provider: 'appAttest',
            debugToken: 'YOUR_DEBUG_TOKEN', // For emulators/simulators
          },
        });

        if (!checkProvider) {
          console.error("App Check is not supported on this platform.");
          return;
        }
        
        try {
          // In a debug environment, it's useful to use a debug token.
          // In production, you'll rely on the attestation providers (Play Integrity/App Attest).
          if (__DEV__) {
            await appCheck().setTokenAutoRefresh(true);
            await appCheck().activate(checkProvider.debugToken, true);
            console.log("✅ Firebase App Check activated in DEBUG mode (Native).");
          } else {
            // Production mode
            await appCheck().activate(checkProvider.provider, true);
            console.log("✅ Firebase App Check activated in PRODUCTION mode (Native).");
          }
        } catch (error) {
          console.error("❌ Error activating Firebase App Check (Native):", error);
        }
      }

      // --- Google Sign-In Initialization ---
      initializeGoogleSignIn();
    };

    initializeAppServices();
  }, []);
}
