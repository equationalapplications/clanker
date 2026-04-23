/// <reference types="expo-router/types" />
import 'expo-dev-client'
import { StatusBar } from 'expo-status-bar'
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context'
import { View, StyleSheet, Pressable, AppState } from 'react-native'
import { useEffect, useRef } from 'react'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { Stack, router } from 'expo-router'

import { KeyboardProvider } from 'react-native-keyboard-controller'

import { useSelector, useActorRef } from '@xstate/react'
import { ThemeProvider } from '~/components/ThemeProvider'
import { Icon, useTheme } from 'react-native-paper'
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
import { characterMachine } from '~/machines/characterMachine'
import {
  GlobalStateContext,
  useAuthMachine,
  useCharacterMachine,
  useTermsMachine,
} from '~/hooks/useMachines'

/**
 * Wires cross-machine coordination in one place.
 *
 * Every time a new machine is added to GlobalStateContext, the forwarding
 * rules for that machine live here rather than being spread across the layout.
 *
 * Current wiring:
 *   authMachine → characterMachine : USER_CHANGED  (deduplicated by userId)
 *   authMachine → termsMachine     : AUTH_STATE_CHANGED (deduplicated by snapshot)
 */
function AppOrchestrator({ children }: { children: React.ReactNode }) {
  const authService = useAuthMachine()
  const termsService = useTermsMachine()
  const characterService = useCharacterMachine()

  const previousAuthSnapshotRef = useRef<
    {
      isSignedInState: boolean
      firebaseUserId: string | null
      dbUserId: string | null
      planTier: string | null
      planStatus: string | null
      currentCredits: number | null
      termsVersion: string | null
      termsAcceptedAt: string | null
    } | null
  >(null)

  // authMachine → characterMachine: forward user changes (deduplicated)
  const previousCharacterUserIdRef = useRef<string | null>(null)
  useEffect(() => {
    const subscription = authService.subscribe((state) => {
      const userId = state.context.user?.uid ?? null
      if (userId !== previousCharacterUserIdRef.current) {
        previousCharacterUserIdRef.current = userId
        characterService.send({ type: 'USER_CHANGED', userId })
      }
    })
    return subscription.unsubscribe
  }, [authService, characterService])

  // authMachine → termsMachine: forward auth state changes (deduplicated)
  useEffect(() => {
    const subscription = authService.subscribe((state) => {
      const firebaseUserId = state.context.user?.uid ?? null
      const dbUserId = state.context.dbUser?.id ?? null
      const subscription = state.context.subscription
      const nextAuthSnapshot = {
        isSignedInState: state.matches('signedIn'),
        firebaseUserId,
        dbUserId,
        planTier: subscription?.planTier ?? null,
        planStatus: subscription?.planStatus ?? null,
        currentCredits: subscription?.currentCredits ?? null,
        termsVersion: subscription?.termsVersion ?? null,
        termsAcceptedAt: subscription?.termsAcceptedAt ?? null,
      }
      const previousAuthSnapshot = previousAuthSnapshotRef.current

      if (
        !previousAuthSnapshot ||
        previousAuthSnapshot.isSignedInState !== nextAuthSnapshot.isSignedInState ||
        previousAuthSnapshot.firebaseUserId !== nextAuthSnapshot.firebaseUserId ||
        previousAuthSnapshot.dbUserId !== nextAuthSnapshot.dbUserId ||
        previousAuthSnapshot.planTier !== nextAuthSnapshot.planTier ||
        previousAuthSnapshot.planStatus !== nextAuthSnapshot.planStatus ||
        previousAuthSnapshot.currentCredits !== nextAuthSnapshot.currentCredits ||
        previousAuthSnapshot.termsVersion !== nextAuthSnapshot.termsVersion ||
        previousAuthSnapshot.termsAcceptedAt !== nextAuthSnapshot.termsAcceptedAt
      ) {
        previousAuthSnapshotRef.current = nextAuthSnapshot
        termsService.send({ type: 'AUTH_STATE_CHANGED', authState: state })
      }
    })

    return subscription.unsubscribe
  }, [authService, termsService])

  // lifecycle → authMachine: foreground signal for stale-gated bootstrap refresh
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        authService.send({ type: 'APP_FOREGROUNDED', at: new Date().toISOString() })
      }
    })

    return () => subscription.remove()
  }, [authService])

  return <>{children}</>
}

/**
 * Creates the three core xState actors and publishes them via GlobalStateContext.
 * Coordination between machines is handled by the nested AppOrchestrator.
 * To add a new machine: spawn it here with useActorRef, add it to the context value,
 * and wire any cross-machine events in AppOrchestrator.
 */
function GlobalStateProvider({ children }: { children: React.ReactNode }) {
  const authService = useActorRef(authMachine)
  const termsService = useActorRef(termsMachine)
  const characterService = useActorRef(characterMachine)

  return (
    <GlobalStateContext.Provider value={{ authService, termsService, characterService }}>
      <AppOrchestrator>{children}</AppOrchestrator>
    </GlobalStateContext.Provider>
  )
}

// This component handles the core authentication logic using Stack.Protected
function RootLayoutNav() {
  const { colors } = useTheme()
  useInitializeApp()
  const authService = useAuthMachine()
  const characterService = useCharacterMachine()
  const { user, isLoading } = useSelector(authService, (state) => ({
    user: state.context.user,
    isLoading:
      state.matches('initializing') ||
      state.matches('signingIn') ||
      state.matches('bootstrapping'),
  }))
  const prevUserRef = useRef<typeof user>(null)

  // Set up network detection and bridge to React Query's onlineManager.
  // Also trigger a background character sync whenever the device comes back online.
  useEffect(() => {
    const unsubscribe = setupNetworkManager(() => {
      import('~/services/characterSyncService')
        .then(({ syncAllToCloud }) => syncAllToCloud())
        .then(() => characterService.send({ type: 'LOAD' }))
        .catch((err) => console.warn('Background sync failed:', err))
    })
    return unsubscribe
  }, [characterService])

  // Sync pending local changes to cloud on app startup after auth resolves.
  // The reconnect callback fires on offline→online transitions,
  // so this covers the case where the user made offline edits, closed the app,
  // and reopened while already online.
  // Gate on !isLoading so that Supabase session (setSession) is ready before sync.
  useEffect(() => {
    if (user && !isLoading && !prevUserRef.current) {
      // Use NetInfo.fetch() for the real initial state — onlineManager defaults to
      // online until the NetInfo bridge fires, which can cause false-positive syncs.
      NetInfo.fetch()
        .then((state) => {
          const isOnline =
            state.isConnected != null && state.isConnected && state.isInternetReachable !== false
          if (isOnline) {
            import('~/services/characterSyncService')
              .then(({ syncAllToCloud }) => syncAllToCloud())
              .then(() => characterService.send({ type: 'LOAD' }))
              .catch((err) => console.warn('Startup sync failed:', err))
          }
        })
        .catch((err) => {
          console.warn('Startup NetInfo.fetch failed, skipping initial sync:', err)
        })
    }
    prevUserRef.current = user
  }, [user, isLoading, characterService])

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <LoadingIndicator disabled={false} />
      </View>
    )
  }

  return (
    <Stack>
      {/* Landing page - always accessible, no header */}
      <Stack.Screen name="index" options={{ headerShown: false }} />

      {/* Protected routes - only available when logged in */}
      <Stack.Protected guard={!!user}>
        <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
        <Stack.Screen name="admin" options={{ headerShown: false }} />
      </Stack.Protected>

      {/* Public routes - only available when NOT logged in */}
      <Stack.Protected guard={!user}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>

      {/* Info pages - always available */}
      <Stack.Screen
        name="privacy"
        options={({ navigation }) => ({
          presentation: 'modal',
          title: 'Privacy Policy',
          headerBackButtonDisplayMode: 'minimal',
          headerLeft: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={8}
              style={styles.headerBackButton}
              onPress={() => {
                if (navigation.canGoBack()) {
                  navigation.goBack()
                  return
                }
                router.replace('/')
              }}
            >
              <Icon source="arrow-left" size={24} color={colors.onSurface} />
            </Pressable>
          ),
        })}
      />
      <Stack.Screen
        name="terms"
        options={({ navigation }) => ({
          presentation: 'modal',
          title: 'Terms and Conditions',
          headerBackButtonDisplayMode: 'minimal',
          headerLeft: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={8}
              style={styles.headerBackButton}
              onPress={() => {
                if (navigation.canGoBack()) {
                  navigation.goBack()
                  return
                }
                router.replace('/')
              }}
            >
              <Icon source="arrow-left" size={24} color={colors.onSurface} />
            </Pressable>
          ),
        })}
      />
      <Stack.Screen
        name="support"
        options={{
          title: 'Support',
          headerBackTitle: 'Back',
        }}
      />
      <Stack.Screen name="checkout/success" options={{ headerShown: false }} />
      <Stack.Screen name="checkout/cancel" options={{ headerShown: false }} />
    </Stack>
  )
}

export default function RootLayout() {
  const isLoadingComplete = useCachedResources()

  if (!isLoadingComplete) {
    return (
      <View style={styles.loadingContainer}>
        <LoadingIndicator disabled={false} />
      </View>
    )
  }

  return (
    <SettingsProvider>
      <ThemeProvider>
        <GlobalStateProvider>
          <PersistQueryClientProvider
            client={queryClient}
            persistOptions={{
              persister: kvStorePersister,
              maxAge: 1000 * 60 * 60 * 24,
            }}
          >
            <SafeAreaProvider initialMetrics={initialWindowMetrics}>
              <KeyboardProvider>
                <StatusBar style="auto" />
                <RootLayoutNav />
              </KeyboardProvider>
            </SafeAreaProvider>
          </PersistQueryClientProvider>
        </GlobalStateProvider>
      </ThemeProvider>
    </SettingsProvider>
  )
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerBackButton: {
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
})
