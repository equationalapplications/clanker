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
  recordTermsDecline,
  clearTermsDecline,
} from '~/machines/termsMachine'
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

// First Terms version that can only have been accepted through the age gate. The gate shipped
// while TERMS.version (termsConfig.ts) was '2.4', and 2.4 was also accepted by pre-gate accounts,
// so the next bump ('2.5') is the first trusted version. Deliberately NOT bumped here: forcing
// every account to re-accept is a product/legal call. Until the next Terms bump, 2.4 accounts stay
// accepted; on that bump they run the age check (post-gate 2.4 signups are re-checked too, which
// is redundant but fail-safe).
const FIRST_AGE_GATED_TERMS_VERSION = '2.5'

// Compares [major, minor] numerically. Accepts only complete, recognized terms-version
// values (e.g. "2.5", "2.10"); malformed strings such as "2.5-beta" or "2.5garbage"
// fail closed (force age check) rather than silently matching the "2.5" prefix.
function isAtLeastVersion(version: string | null | undefined, minimum: string): boolean {
  const parse = (v: string) => {
    const match = /^(\d+)\.(\d+)$/.exec(v)
    return match ? [Number(match[1]), Number(match[2])] : null
  }
  const actual = version ? parse(version) : null
  const required = parse(minimum)
  if (!actual || !required) return false
  return actual[0] !== required[0] ? actual[0] > required[0] : actual[1] >= required[1]
}

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
    isUpdate,
    previousTermsVersion,
    accepting,
    error,
  } = useSelector(termsService, (state) => ({
    termsAccepted: state.matches('accepted'),
    termsBlocking: state.matches('acceptanceRequired'),
    termsLoading: state.matches('idle') || state.matches('checking'),
    isUpdate: state.context.isUpdate,
    previousTermsVersion: state.context.subscription?.termsVersion ?? null,
    accepting: state.matches('accepting'),
    error: state.context.error,
  }))

  const previousTermsAccepted = useRef<boolean>(termsAccepted)

  useEffect(() => {
    if (!previousTermsAccepted.current && termsAccepted) {
      // A real acceptance supersedes any decline record (issue #810).
      clearTermsDecline()
      authService.send({
        type: 'TERMS_ACCEPTED_LOCAL',
        termsVersion: TERMS.version,
        termsAcceptedAt: new Date().toISOString(),
      })
    }
    previousTermsAccepted.current = termsAccepted
  }, [termsAccepted, authService])

  const acceptTerms = () => termsService.send({ type: 'ACCEPT_TERMS', isUpdate })

  // Decline = notice-then-enforce (ToS §12.19 option [B], issue #810): the user is NOT signed
  // out and keeps access under the previously accepted Terms. We record declined-not-accepted
  // (subscription.termsVersion is untouched) so the blocking surface resumes at the next
  // acceptance check after the paid period ends (24h fallback when billing gives no period end).
  const handleDeclined = () => {
    const subscription = termsService.getSnapshot().context.subscription
    const periodEnd = subscription?.nextExpiryDate ?? null
    const now = new Date()
    const parsed = periodEnd ? Date.parse(periodEnd) : NaN
    const windowEnd =
      !Number.isNaN(parsed) && parsed > now.getTime()
        ? periodEnd as string
        : new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
    recordTermsDecline(windowEnd, now)
    termsService.send({ type: 'DECLINE_TERMS' })
    showAlert(
      'Terms declined',
      "You can keep using Clanker under the previous Terms until the end of the period you've already paid for. Your next renewal requires accepting the updated Terms — you can also cancel before renewal in your account or store settings.",
    )
  }

  const {
    verifyAge,
    isVerifying,
    showDobPicker,
    handleDobResult,
    needsPlayVerification,
    retryPlayVerification,
  } = useAgeVerification({
    onVerified: acceptTerms,
    onRejected: () => {
      showAlert('Age Restriction', 'This app is for users 18 and older.')
      authService.send({ type: 'SIGN_OUT' })
    },
  })

  // Re-acceptance skip rule: there is no dedicated age-verification record, so the age check is
  // skipped ONLY when this is a re-acceptance (termsMachine `isUpdate`) AND the previously
  // accepted version (subscription.termsVersion) is >= FIRST_AGE_GATED_TERMS_VERSION, i.e. it
  // was accepted through the age gate. Legacy accounts (accepted before the gate existed) and
  // new accounts must complete the age flow first.
  const ageAlreadyVerified =
    isUpdate && isAtLeastVersion(previousTermsVersion, FIRST_AGE_GATED_TERMS_VERSION)
  const handleAccepted = ageAlreadyVerified ? acceptTerms : verifyAge

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
            onAccepted={retryPlayVerification}
            onCanceled={handleDeclined}
            isUpdate={isUpdate}
            accepting={isVerifying}
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
          {termsAccepted ? (
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
      <Drawer.Screen
        name="(tabs)"
        options={termsAccepted ? undefined : HIDDEN_DRAWER_SCREEN_OPTIONS}
      />
      <Drawer.Screen
        name="profile"
        options={termsAccepted ? undefined : HIDDEN_DRAWER_SCREEN_OPTIONS}
      />
      <Drawer.Screen
        name="settings"
        options={termsAccepted ? undefined : HIDDEN_DRAWER_SCREEN_OPTIONS}
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
        options={termsAccepted ? undefined : HIDDEN_DRAWER_SCREEN_OPTIONS}
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
