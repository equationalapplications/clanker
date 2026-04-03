/// <reference types="expo-router/types" />
import 'expo-dev-client'
import { StatusBar } from 'expo-status-bar'
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context'
import { View, StyleSheet } from 'react-native'
import { useEffect, useRef } from 'react'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { Stack } from 'expo-router'

import { KeyboardProvider } from 'react-native-keyboard-controller'

import { useSelector, useActorRef } from '@xstate/react'
import { ThemeProvider } from '~/components/ThemeProvider'
import { SettingsProvider } from '~/contexts/SettingsContext'
import { queryClient } from '~/config/queryClient'
import { kvStorePersister } from '~/config/queryPersister'
import { setupNetworkManager } from '~/config/networkManager'
import NetInfo from '@react-native-community/netinfo'
import LoadingIndicator from '~/components/LoadingIndicator'
import useCachedResources from '~/hooks/useCachedResources'
import { useInitializeApp } from '~/hooks/useInitializeApp'
import { authMachine } from '~/machines/authMachine'
import { termsMachine } from '~/machines/termsMachine'
import { GlobalStateContext, useAuthMachine } from '~/hooks/useMachines'

function GlobalStateProvider({ children }: { children: React.ReactNode }) {
  const authService = useActorRef(authMachine);
  const termsService = useActorRef(termsMachine);

  useEffect(() => {
    const subscription = authService.subscribe((state: any) => {
      termsService.send({ type: 'AUTH_STATE_CHANGED', authState: state });
    });

    return subscription.unsubscribe;
  }, [authService, termsService]);

  return (
    <GlobalStateContext.Provider value={{ authService, termsService }}>
      {children}
    </GlobalStateContext.Provider>
  );
}

// This component handles the core authentication logic using Stack.Protected
function RootLayoutNav() {
  useInitializeApp()
  const authService = useAuthMachine();
  const { user, isLoading } = useSelector(authService, (state) => ({
    user: state.context.user,
    isLoading: state.matches('initializing') || state.matches('exchangingToken'),
  }));
  const prevUserRef = useRef<typeof user>(null)

  // Sync pending local changes to cloud on app startup after auth resolves.
  // The reconnect callback in RootLayout only fires on offline→online transitions,
  // so this covers the case where the user made offline edits, closed the app,
  // and reopened while already online.
  // Gate on !isLoading so that Supabase session (setSession) is ready before sync.
  useEffect(() => {
    if (user && !isLoading && !prevUserRef.current) {
      // Use NetInfo.fetch() for the real initial state — onlineManager defaults to
      // online until the NetInfo bridge fires, which can cause false-positive syncs.
      NetInfo.fetch()
        .then((state) => {
          const isOnline = state.isConnected != null &&
            state.isConnected &&
            state.isInternetReachable !== false
          if (isOnline) {
            import('~/services/characterSyncService')
              .then(({ syncAllToCloud }) => syncAllToCloud())
              .catch((err) => console.warn('Startup sync failed:', err))
          }
        })
        .catch((err) => {
          console.warn('Startup NetInfo.fetch failed, skipping initial sync:', err)
        })
    }
    prevUserRef.current = user
  }, [user, isLoading])

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <LoadingIndicator disabled={false} />
      </View>
    );
  }

  return (
    <Stack>
      {/* Protected routes - only available when logged in */}
      <Stack.Protected guard={!!user}>
        <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
      </Stack.Protected>

      {/* Public routes - only available when NOT logged in */}
      <Stack.Protected guard={!user}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>

      {/* Info pages - always available */}
      <Stack.Screen name="privacy" options={{ presentation: 'modal', title: 'Privacy Policy' }} />
      <Stack.Screen
        name="terms"
        options={{ presentation: 'modal', title: 'Terms and Conditions' }}
      />
      <Stack.Screen name="checkout/success" options={{ headerShown: false }} />
      <Stack.Screen name="checkout/cancel" options={{ headerShown: false }} />
    </Stack>
  )
}

export default function RootLayout() {
  const isLoadingComplete = useCachedResources()

  // Set up network detection and bridge to React Query's onlineManager.
  // Also trigger a background character sync whenever the device comes back online.
  useEffect(() => {
    const unsubscribe = setupNetworkManager(() => {
      // Lazy-import to avoid circular deps at module load time
      import('~/services/characterSyncService')
        .then(({ syncAllToCloud }) => syncAllToCloud())
        .catch((err) => console.warn('Background sync failed:', err))
    })
    return unsubscribe
  }, [])

  if (!isLoadingComplete) {
    return (
      <View style={styles.loadingContainer}>
        <LoadingIndicator disabled={false} />
      </View>
    )
  }

  return (
    <ThemeProvider>
      <SettingsProvider>
        <GlobalStateProvider>
          <PersistQueryClientProvider
            client={queryClient}
            persistOptions={{ persister: kvStorePersister }}
          >
            <SafeAreaProvider initialMetrics={initialWindowMetrics}>
              <KeyboardProvider>
                <StatusBar style="auto" />
                <RootLayoutNav />
              </KeyboardProvider>
            </SafeAreaProvider>
          </PersistQueryClientProvider>
        </GlobalStateProvider>
      </SettingsProvider>
    </ThemeProvider>
  )
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
})
