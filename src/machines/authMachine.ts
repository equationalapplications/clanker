import { createMachine, assign, fromPromise, fromCallback } from 'xstate'
import {
  FirebaseUser as User,
  onAuthStateChanged,
  signOut as firebaseSignOut,
} from '~/config/firebaseConfig'
import { Platform } from 'react-native'

import { signInWithGoogle, GoogleSignInResult, signOutFromGoogle } from '~/auth/googleSignin'
import { signInWithApple, AppleSignInResult, signOutFromApple } from '~/auth/appleSignin'
import { bootstrapSession, UserSnapshot, SubscriptionSnapshot } from '~/auth/bootstrapSession'
import { loginRevenueCat, logoutRevenueCat } from '~/config/revenueCatConfig'
import { setCrashlyticsUserId } from '~/services/crashlyticsService'
import { queryClient } from '~/config/queryClient'
import { kvStorePersister } from '~/config/queryPersister'

export type BootstrapRefreshReason =
  | 'purchase'
  | 'restore'
  | 'manual'
  | 'terms'
  | 'foreground'

type UsagePlanStatus = 'active' | 'cancelled' | 'expired' | null

const REFRESH_THROTTLE_MS = 2000
const FOREGROUND_STALE_MS = 5 * 60 * 1000

const CRITICAL_REFRESH_REASONS: BootstrapRefreshReason[] = ['purchase', 'restore']

const getRefreshPriority = (reason: BootstrapRefreshReason): number => {
  if (reason === 'purchase' || reason === 'restore') return 3
  if (reason === 'manual') return 2
  return 1
}

const shouldBypassThrottle = (reason: BootstrapRefreshReason): boolean => {
  return reason === 'manual' || CRITICAL_REFRESH_REASONS.includes(reason)
}

const parseTimestamp = (value: string | null): number | null => {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : time
}

export interface AuthMachineContext {
  user: User | null
  dbUser: UserSnapshot | null
  subscription: SubscriptionSnapshot | null
  error: Error | null
  lastRefreshReason: BootstrapRefreshReason | null
  lastRefreshAt: string | null
  activeRefreshReason: BootstrapRefreshReason | null
  pendingRefreshReason: BootstrapRefreshReason | null
  lastUsageSnapshotAt: string | null
  identitySetupUid: string | null
}

export type AuthMachineEvents =
  | { type: 'USER_FOUND'; user: User }
  | { type: 'NO_USER_FOUND' }
  | { type: 'SIGN_IN'; provider: 'google' | 'apple' }
  | { type: 'SIGN_OUT' }
  | { type: 'REFRESH_BOOTSTRAP'; reason: BootstrapRefreshReason }
  | { type: 'APP_FOREGROUNDED'; at: string }
  | {
      type: 'USAGE_SNAPSHOT_RECEIVED'
      source: 'generateReply' | 'generateImage'
      remainingCredits: number | null
      planTier: string | null
      planStatus: UsagePlanStatus
      verifiedAt: string
    }
  | {
      type: 'TERMS_ACCEPTED_LOCAL'
      termsVersion: string
      termsAcceptedAt: string
    }
  | {
      type: 'TERMS_REVERTED_LOCAL'
      termsVersion: string | null
      termsAcceptedAt: string | null
    }
  | { type: 'DB_USER_PATCHED_LOCAL'; updates: Partial<UserSnapshot> }
  | { type: 'PROFILE_PATCHED_LOCAL'; updates: Partial<UserSnapshot> }

export const authMachine = createMachine(
  {
    id: 'authMachine',
    types: {} as {
      context: AuthMachineContext
      events: AuthMachineEvents
    },
    initial: 'initializing',
    context: {
      user: null,
      dbUser: null,
      subscription: null,
      error: null,
      lastRefreshReason: null,
      lastRefreshAt: null,
      activeRefreshReason: null,
      pendingRefreshReason: null,
      lastUsageSnapshotAt: null,
      identitySetupUid: null,
    } as AuthMachineContext,
    invoke: {
      id: 'listenToAuthState',
      src: 'listenToAuthState',
    },
    on: {
      USER_FOUND: {
        target: '.bootstrapping',
        actions: assign({ user: ({ event }) => event.user }),
      },
      NO_USER_FOUND: [
        {
          target: '.signedOut',
          guard: 'hadActiveSession',
          actions: ['clearSessionData', assign({ error: null })],
        },
        {
          target: '.signedOut',
          actions: assign({ error: null }),
        },
      ],
      SIGN_OUT: [
        {
          guard: 'hadActiveSession',
          target: '#authMachine.signingOut',
          reenter: false,
        },
      ],
      TERMS_ACCEPTED_LOCAL: {
        actions: 'applyTermsAcceptedLocal',
      },
      TERMS_REVERTED_LOCAL: {
        actions: 'applyTermsRevertedLocal',
      },
      DB_USER_PATCHED_LOCAL: {
        actions: 'patchDbUserLocal',
      },
      PROFILE_PATCHED_LOCAL: {
        actions: 'patchDbUserLocal',
      },
      USAGE_SNAPSHOT_RECEIVED: {
        actions: 'applyUsageSnapshotIfNewer',
      },
    },
    states: {
      initializing: {},
      signedOut: {
        entry: assign({
          user: null,
          dbUser: null,
          subscription: null,
          error: ({ context }) => context.error,
          pendingRefreshReason: null,
          activeRefreshReason: null,
          lastRefreshReason: null,
          lastRefreshAt: null,
          lastUsageSnapshotAt: null,
          identitySetupUid: null,
        }),
        on: {
          SIGN_IN: 'signingIn',
        },
      },
      signingIn: {
        invoke: {
          id: 'signInProvider',
          src: 'signInProvider',
          input: ({ event }) => ({ provider: (event as any).provider }),
          onError: {
            target: 'signedOut',
            actions: assign({ error: ({ event }) => event.error as Error }),
          },
        },
        // USER_FOUND from the top-level listener will drive the transition to bootstrapping
      },
      bootstrapping: {
        on: {
          REFRESH_BOOTSTRAP: {
            actions: 'queueRefreshReason',
          },
          APP_FOREGROUNDED: {
            actions: 'queueForegroundRefreshReason',
          },
        },
        invoke: {
          id: 'bootstrapAppSession',
          src: 'bootstrapAppSession',
          input: ({ context }) => ({ user: context.user }),
          onDone: {
            target: 'signedIn',
            actions: [
              assign({
                dbUser: ({ event }) => event.output.user,
                subscription: ({ event }) => event.output.subscription,
                error: null,
              }),
              'markRefreshCompleted',
            ],
          },
          onError: {
            target: 'signedOut',
            actions: ['clearFailedBootstrapSession', assign({ error: ({ event }) => event.error as Error })],
          },
        },
      },
      signedIn: {
        entry: [
          'runIdentitySetupIfNeeded',
          assign({ identitySetupUid: ({ context }) => context.user?.uid ?? null }),
        ],
        always: [
          {
            guard: 'hasReplayablePendingRefresh',
            target: 'bootstrapping',
            actions: 'startPendingRefreshReplay',
          },
        ],
        on: {
          SIGN_OUT: 'signingOut',
          REFRESH_BOOTSTRAP: [
            {
              guard: 'canStartRefreshFromEvent',
              target: 'bootstrapping',
              actions: 'startRefreshFromEvent',
            },
          ],
          APP_FOREGROUNDED: [
            {
              guard: 'shouldRefreshOnForeground',
              target: 'bootstrapping',
              actions: 'startForegroundRefresh',
            },
          ],
        },
      },
      signingOut: {
        on: {
          // While signing out, we want to ignore auth state changes
          // until the sign out process is complete.
          USER_FOUND: {},
          NO_USER_FOUND: {},
        },
        invoke: {
          id: 'signOut',
          src: 'signOut',
          onDone: {
            target: 'signedOut',
            actions: assign({ error: null }),
          },
          onError: {
            // Even if signout fails, go to signed out state
            target: 'signedOut',
            actions: assign({ error: ({ event }) => event.error as Error }),
          },
        },
      },
    },
  },
  {
    actions: {
      markRefreshCompleted: assign({
        lastRefreshReason: ({ context }) => context.activeRefreshReason,
        lastRefreshAt: () => new Date().toISOString(),
        pendingRefreshReason: ({ context }) => {
          if (!context.activeRefreshReason) return context.pendingRefreshReason
          return context.pendingRefreshReason === context.activeRefreshReason
            ? null
            : context.pendingRefreshReason
        },
        activeRefreshReason: null,
      }),
      startRefreshFromEvent: assign({
        activeRefreshReason: ({ event }) =>
          (event as Extract<AuthMachineEvents, { type: 'REFRESH_BOOTSTRAP' }>).reason,
      }),
      startForegroundRefresh: assign({
        activeRefreshReason: () => 'foreground',
      }),
      queueForegroundRefreshReason: assign({
        pendingRefreshReason: ({ context }) => {
          const reason: BootstrapRefreshReason = 'foreground'
          if (!context.pendingRefreshReason) return reason
          return getRefreshPriority(reason) >= getRefreshPriority(context.pendingRefreshReason)
            ? reason
            : context.pendingRefreshReason
        },
      }),
      queueRefreshReason: assign({
        pendingRefreshReason: ({ context, event }) => {
          const reason = (event as Extract<AuthMachineEvents, { type: 'REFRESH_BOOTSTRAP' }>).reason
          if (!context.pendingRefreshReason) return reason
          return getRefreshPriority(reason) >= getRefreshPriority(context.pendingRefreshReason)
            ? reason
            : context.pendingRefreshReason
        },
      }),
      startPendingRefreshReplay: assign({
        activeRefreshReason: ({ context }) => context.pendingRefreshReason,
        pendingRefreshReason: null,
      }),
      runIdentitySetupIfNeeded: ({ context }) => {
        const uid = context.user?.uid
        if (!uid || context.identitySetupUid === uid) {
          return
        }
        loginRevenueCat(uid)
        setCrashlyticsUserId(uid)
      },
      applyTermsAcceptedLocal: assign({
        subscription: ({ context, event }) => {
          if (!context.subscription) return context.subscription
          const acceptedEvent = event as Extract<AuthMachineEvents, { type: 'TERMS_ACCEPTED_LOCAL' }>
          return {
            ...context.subscription,
            termsVersion: acceptedEvent.termsVersion,
            termsAcceptedAt: acceptedEvent.termsAcceptedAt,
          }
        },
      }),
      applyTermsRevertedLocal: assign({
        subscription: ({ context, event }) => {
          if (!context.subscription) return context.subscription
          const revertedEvent = event as Extract<AuthMachineEvents, { type: 'TERMS_REVERTED_LOCAL' }>
          return {
            ...context.subscription,
            termsVersion: revertedEvent.termsVersion,
            termsAcceptedAt: revertedEvent.termsAcceptedAt,
          }
        },
      }),
      patchDbUserLocal: assign({
        dbUser: ({ context, event }) => {
          if (!context.dbUser) return context.dbUser
          const patchEvent = event as Extract<
            AuthMachineEvents,
            { type: 'DB_USER_PATCHED_LOCAL' | 'PROFILE_PATCHED_LOCAL' }
          >
          return {
            ...context.dbUser,
            ...patchEvent.updates,
          }
        },
      }),
      applyUsageSnapshotIfNewer: assign({
        subscription: ({ context, event }) => {
          if (!context.subscription) return context.subscription
          const usageEvent = event as Extract<AuthMachineEvents, { type: 'USAGE_SNAPSHOT_RECEIVED' }>
          const incomingTs = parseTimestamp(usageEvent.verifiedAt)
          const currentTs = parseTimestamp(context.lastUsageSnapshotAt)
          if (!incomingTs) {
            return context.subscription
          }
          if (currentTs && incomingTs <= currentTs) {
            return context.subscription
          }

          return {
            ...context.subscription,
            currentCredits:
              usageEvent.remainingCredits === null
                ? context.subscription.currentCredits
                : Math.max(0, usageEvent.remainingCredits),
            planTier: usageEvent.planTier ?? context.subscription.planTier,
            planStatus: usageEvent.planStatus ?? context.subscription.planStatus,
          }
        },
        lastUsageSnapshotAt: ({ context, event }) => {
          const usageEvent = event as Extract<AuthMachineEvents, { type: 'USAGE_SNAPSHOT_RECEIVED' }>
          const incomingTs = parseTimestamp(usageEvent.verifiedAt)
          const currentTs = parseTimestamp(context.lastUsageSnapshotAt)
          if (!incomingTs) return context.lastUsageSnapshotAt
          if (currentTs && incomingTs <= currentTs) return context.lastUsageSnapshotAt
          return usageEvent.verifiedAt
        },
      }),
      clearSessionData: () => {
        Promise.all([
          setCrashlyticsUserId(null),
          logoutRevenueCat(),
          kvStorePersister.removeClient(),
        ]).catch((err) => console.error('clearSessionData failed:', err))
        queryClient.clear()
      },
      clearFailedBootstrapSession: () => {
        Promise.all([
          firebaseSignOut(),
          setCrashlyticsUserId(null),
          logoutRevenueCat(),
          kvStorePersister.removeClient(),
        ]).catch((err) => console.error('clearFailedBootstrapSession failed:', err))
        queryClient.clear()
      },
    },
    guards: {
      hadActiveSession: ({ context }) => context.user !== null || context.dbUser !== null,
      canStartRefreshFromEvent: ({ context, event }) => {
        const reason = (event as Extract<AuthMachineEvents, { type: 'REFRESH_BOOTSTRAP' }>).reason
        if (shouldBypassThrottle(reason)) return true

        if (!context.lastRefreshReason || !context.lastRefreshAt) {
          return true
        }

        if (context.lastRefreshReason !== reason) {
          return true
        }

        const elapsed = Date.now() - Date.parse(context.lastRefreshAt)
        if (Number.isNaN(elapsed)) {
          return true
        }

        return elapsed >= REFRESH_THROTTLE_MS
      },
      hasReplayablePendingRefresh: ({ context }) => {
        if (!context.pendingRefreshReason) return false
        return context.pendingRefreshReason !== context.lastRefreshReason
      },
      shouldRefreshOnForeground: ({ context, event }) => {
        if (!context.user) return false
        const atMs = Date.parse((event as Extract<AuthMachineEvents, { type: 'APP_FOREGROUNDED' }>).at)
        if (Number.isNaN(atMs)) return false
        if (!context.lastRefreshAt) return true
        const lastMs = Date.parse(context.lastRefreshAt)
        if (Number.isNaN(lastMs)) return true
        return atMs - lastMs >= FOREGROUND_STALE_MS
      },
    },
    actors: {
      listenToAuthState: fromCallback(({ sendBack }) => {
        const unsubscribe = onAuthStateChanged((user) => {
          if (user) {
            sendBack({ type: 'USER_FOUND', user })
          } else {
            sendBack({ type: 'NO_USER_FOUND' })
          }
        })
        return unsubscribe
      }),
      signInProvider: fromPromise(async ({ input }) => {
        const { provider } = input as { provider: 'google' | 'apple' }
        let result: GoogleSignInResult | AppleSignInResult
        if (provider === 'google') {
          result = await signInWithGoogle()
        } else if (provider === 'apple') {
          result = await signInWithApple()
        } else {
          throw new Error('Unsupported provider')
        }

        if (!result.success) {
          throw new Error(result.error || 'Sign-in failed')
        }
        // This relies on onAuthStateChanged to fire with the new user
        return
      }),
      bootstrapAppSession: fromPromise(async ({ input }) => {
        const { user } = input as { user: User | null }
        if (!user) throw new Error('No user to bootstrap session for')
        return bootstrapSession()
      }),
      signOut: fromPromise(async () => {
        await firebaseSignOut()
        await setCrashlyticsUserId(null)
        await logoutRevenueCat()
        await kvStorePersister.removeClient()
        if (Platform.OS === 'ios') {
          await signOutFromApple()
        } else if (Platform.OS === 'android') {
          await signOutFromGoogle()
        } else {
          await signOutFromGoogle()
        }
        queryClient.clear()
      }),
    },
  },
)
