import {
  DrawerContentScrollView,
  DrawerItem,
  DrawerItemList,
} from 'expo-router/build/react-navigation/drawer'
import { router, useNavigation, type Href } from 'expo-router'
import { Drawer } from 'expo-router/drawer'
import { Text, useTheme, Icon } from 'react-native-paper'
import { Pressable, StyleSheet, View, ColorValue } from 'react-native'
import { useSelector } from '@xstate/react'
import { useAuthMachine, useTermsMachine } from '~/hooks/useMachines'
import { AcceptTerms } from '~/components/AcceptTerms'
import { ManualDobPicker } from '~/components/ManualDobPicker'
import { useAgeVerification } from '~/hooks/useAgeVerification'
import { showAlert } from '~/utilities/showAlert'
import LoadingIndicator from '~/components/LoadingIndicator'
import { useEffect, useRef } from 'react'
import { TERMS } from '~/config/termsConfig'
import {
  handleTermsCanceled,
  handleTermsDecline,
  termsAgeAlreadyVerified,
} from '~/utilities/termsDecline'
import { PowerMeter } from '~/components/PowerMeter'

const DRAWER_ROUTE_CONFIG: Record<string, { label: string; icon: string }> = {
  '(tabs)': { label: 'Chat', icon: 'chat' },
  profile: { label: 'Profile', icon: 'account-circle' },
  settings: { label: 'Settings', icon: 'cog' },
  subscribe: { label: 'Subscribe', icon: 'crown' },
}

const HIDDEN_DRAWER_SCREEN_OPTIONS = {
  headerShown: false,
  drawerItemStyle: { display: 'none' as const },
}

// First Terms version that can only have been accepted through the age gate lives in
// src/utilities/termsDecline.ts (FIRST_AGE_GATED_TERMS_VERSION) so acceptance and
// cancellation cannot drift on the rule.

function DrawerToggleButton({ tintColor }: { tintColor?: ColorValue }) {
  const navigation = useNavigation()
  return (
    <Pressable
      onPress={() => navigation.dispatch({ type: 'TOGGLE_DRAWER' })}
      style={{ marginLeft: 6, padding: 10 }}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel="Toggle navigation drawer"
    >
      <Icon source="menu" color={tintColor ? String(tintColor) : undefined} size={24} />
    </Pressable>
  )
}

const AppLayout = () => {
  const theme = useTheme()
  const termsService = useTermsMachine()
  const authService = useAuthMachine()
  const {
    termsAccepted,
    termsBlocking,
    termsLoading,
    termsDeclined,
    isUpdate,
    previousTermsVersion,
    accepting,
    error,
  } = useSelector(termsService, (state) => ({
    termsAccepted: state.matches('accepted'),
    termsBlocking: state.matches('acceptanceRequired'),
    termsLoading: state.matches('idle') || state.matches('checking'),
    // Resting in 'declined' (notice-then-enforce) keeps the app unblocked: the user still
    // uses Clanker, so drawer navigation — including Subscribe to renew and re-accept —
    // must stay visible (issue #810).
    termsDeclined: state.matches('declined'),
    isUpdate: state.context.isUpdate,
    previousTermsVersion: state.context.subscription?.termsVersion ?? null,
    accepting: state.matches('accepting'),
    error: state.context.error,
  }))

  const previousTermsAccepted = useRef<boolean>(termsAccepted)

  useEffect(() => {
    // The decline record is cleared by termsMachine's acceptance onDone, not here: this
    // effect also fires on every launch that boots straight into 'accepted'.
    if (!previousTermsAccepted.current && termsAccepted) {
      authService.send({
        type: 'TERMS_ACCEPTED_LOCAL',
        termsVersion: TERMS.version,
        termsAcceptedAt: new Date().toISOString(),
      })
    }
    previousTermsAccepted.current = termsAccepted
  }, [termsAccepted, authService])

  const acceptTerms = () => termsService.send({ type: 'ACCEPT_TERMS', isUpdate })

  // What a passed age check resolves into: the age flow runs for both Accept and (legacy
  // accounts) Decline, and a verified adult who tapped Decline must decline — not accept.
  const ageCheckIntent = useRef<'accept' | 'decline'>('accept')

  const {
    verifyAge,
    isVerifying,
    showDobPicker,
    handleDobResult,
    needsPlayVerification,
    retryPlayVerification,
  } = useAgeVerification({
    onVerified: () => {
      if (ageCheckIntent.current === 'decline') {
        handleTermsDecline(termsService)
      } else {
        acceptTerms()
      }
    },
    onRejected: () => {
      showAlert('Age Restriction', 'This app is for users 18 and older.')
      authService.send({ type: 'SIGN_OUT' })
    },
  })

  // Decline vs sign-out policy shared with the accept-terms screen in
  // src/utilities/termsDecline.ts so the rule cannot drift between callers. An update
  // cancel by a legacy (pre-age-gate) account routes through verifyAge (PR #812 review).
  const handleDeclined = () =>
    handleTermsCanceled(
      termsService,
      authService,
      () => {
        ageCheckIntent.current = 'decline'
        void verifyAge()
      },
      needsPlayVerification,
    )

  // Re-acceptance skip rule: there is no dedicated age-verification record, so the age check is
  // skipped ONLY when this is a re-acceptance (termsMachine `isUpdate`) AND the previously
  // accepted version (subscription.termsVersion) is >= FIRST_AGE_GATED_TERMS_VERSION, i.e. it
  // was accepted through the age gate. Legacy accounts (accepted before the gate existed) and
  // new accounts must complete the age flow first. Shared with the cancel path via
  // termsAgeAlreadyVerified in src/utilities/termsDecline.ts.
  const ageAlreadyVerified = termsAgeAlreadyVerified(isUpdate, previousTermsVersion)
  const handleAccepted = ageAlreadyVerified
    ? acceptTerms
    : () => {
        ageCheckIntent.current = 'accept'
        void verifyAge()
      }
  const handlePlayRetry = () => {
    ageCheckIntent.current = 'accept'
    retryPlayVerification()
  }

  // The DOB picker replaces AcceptTerms, which would otherwise surface the error inline.
  useEffect(() => {
    if (showDobPicker && error) {
      showAlert(
        'Error',
        `Failed to record your acceptance. Please check your connection and try again.\n\n${error.message}`,
      )
    }
  }, [showDobPicker, error])

  if (termsLoading) {
    return <LoadingIndicator disabled={false} />
  }

  if (termsBlocking || accepting) {
    if (needsPlayVerification) {
      // Persistent guidance: Play returns VERIFICATION_REQUIRED, which means
      // the user must complete age verification in the Play Store before we
      // can read any age signal. Routing this through AcceptTerms' `error`
      // prop would surface it as an acceptance-failure alert that disappears
      // on dismiss — instead, show it as a persistent banner above the
      // AcceptTerms retry surface (the Accept button re-runs verification).
      return (
        <View style={styles.blockingContainer}>
          <View style={styles.playVerificationBanner}>
            <Text variant="titleSmall" style={styles.playVerificationTitle}>
              Age Verification Required
            </Text>
            <Text variant="bodySmall" style={styles.playVerificationText}>
              Google Play requires age verification for your account before you can continue. Open
              the Google Play Store, complete the age verification it shows you, then tap Accept to
              retry.
            </Text>
          </View>
          <AcceptTerms
            onAccepted={handlePlayRetry}
            onCanceled={handleDeclined}
            isUpdate={isUpdate}
            // Same disabled-during-write contract as the branch below: a decline confirmed
            // mid-write would persist a record for an acceptance that is about to succeed.
            accepting={accepting || isVerifying}
          />
        </View>
      )
    }

    if (showDobPicker) {
      return (
        <View style={styles.blockingContainer}>
          <ManualDobPicker onComplete={handleDobResult} loading={accepting} />
        </View>
      )
    }

    return (
      <View style={styles.blockingContainer}>
        <AcceptTerms
          onAccepted={handleAccepted}
          onCanceled={handleDeclined}
          isUpdate={isUpdate}
          accepting={accepting || isVerifying}
          error={error?.message}
        />
      </View>
    )
  }

  return (
    <Drawer
      drawerContent={(props) => (
        <DrawerContentScrollView {...props}>
          <DrawerItemList {...props} />
          {/* Declining keeps access (issue #810), so Support stays available then too. */}
          {termsAccepted || termsDeclined ? (
            <DrawerItem
              label="Support"
              icon={({ color, size }) => (
                <Icon source="lifebuoy" color={String(color)} size={size} />
              )}
              onPress={() => router.push('/support' as Href)}
            />
          ) : null}
        </DrawerContentScrollView>
      )}
      screenOptions={({ route }) => ({
        ...(() => {
          const routeConfig = DRAWER_ROUTE_CONFIG[route.name]
          if (!routeConfig) {
            return {}
          }

          return {
            drawerLabel: routeConfig.label,
            title: routeConfig.label,
            headerTitle: routeConfig.label,
            drawerIcon: ({ color, size }: { color: ColorValue; size: number }) => (
              <Icon source={routeConfig.icon} color={String(color)} size={size} />
            ),
          }
        })(),
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.onSurface,
        drawerStyle: { backgroundColor: theme.colors.surface },
        drawerActiveTintColor: theme.colors.primary,
        drawerInactiveTintColor: theme.colors.onSurfaceVariant,
        headerLeft: ({ tintColor }) => <DrawerToggleButton tintColor={tintColor} />,
        headerRight: () => <PowerMeter />,
      })}
    >
      {/* Declining keeps access (issue #810): drawer navigation stays visible while the
          decline window runs, so the user can reach Subscribe to renew and re-accept. */}
      <Drawer.Screen
        name="(tabs)"
        options={termsAccepted || termsDeclined ? undefined : HIDDEN_DRAWER_SCREEN_OPTIONS}
      />
      <Drawer.Screen
        name="profile"
        options={termsAccepted || termsDeclined ? undefined : HIDDEN_DRAWER_SCREEN_OPTIONS}
      />
      <Drawer.Screen
        name="settings"
        options={termsAccepted || termsDeclined ? undefined : HIDDEN_DRAWER_SCREEN_OPTIONS}
      />
      <Drawer.Screen
        name="accept-terms"
        options={{
          headerShown: false,
          drawerItemStyle: { display: 'none' },
        }}
      />
      <Drawer.Screen
        name="subscribe"
        options={termsAccepted || termsDeclined ? undefined : HIDDEN_DRAWER_SCREEN_OPTIONS}
      />
    </Drawer>
  )
}

const styles = StyleSheet.create({
  blockingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'stretch',
  },
  playVerificationBanner: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFF4E5',
    borderBottomWidth: 1,
    borderBottomColor: '#E0CDA8',
  },
  playVerificationTitle: {
    fontWeight: '600',
    marginBottom: 4,
  },
  playVerificationText: {
    lineHeight: 18,
  },
})

export default AppLayout
