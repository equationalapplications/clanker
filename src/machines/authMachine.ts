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

export interface AuthMachineContext {
  user: User | null
  dbUser: UserSnapshot | null
  subscription: SubscriptionSnapshot | null
  error: Error | null
}

export type AuthMachineEvents =
  | { type: 'USER_FOUND'; user: User }
  | { type: 'NO_USER_FOUND' }
  | { type: 'SIGN_IN'; provider: 'google' | 'apple' }
  | { type: 'SIGN_OUT' }
  | { type: 'REFRESH_BOOTSTRAP' }

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
          actions: 'clearSessionData',
        },
        {
          target: '.signedOut',
        },
      ],
      SIGN_OUT: [
        {
          guard: 'hadActiveSession',
          target: '#authMachine.signingOut',
          reenter: false,
        },
      ],
    },
    states: {
      initializing: {},
      signedOut: {
        entry: assign({
          user: null,
          dbUser: null,
          subscription: null,
          error: ({ context }) => context.error,
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
        invoke: {
          id: 'bootstrapAppSession',
          src: 'bootstrapAppSession',
          input: ({ context }) => ({ user: context.user }),
          onDone: {
            target: 'signedIn',
            actions: assign({
              dbUser: ({ event }) => event.output.user,
              subscription: ({ event }) => event.output.subscription,
              error: null,
            }),
          },
          onError: {
            target: 'signedOut',
            actions: assign({ error: ({ event }) => event.error as Error }),
          },
        },
      },
      signedIn: {
        entry: [
          ({ context }) => loginRevenueCat(context.user!.uid),
          ({ context }) => setCrashlyticsUserId(context.user!.uid),
        ],
        on: {
          SIGN_OUT: 'signingOut',
          REFRESH_BOOTSTRAP: 'bootstrapping',
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
      clearSessionData: () => {
        Promise.all([
          setCrashlyticsUserId(null),
          logoutRevenueCat(),
        ]).catch((err) => console.error('clearSessionData failed:', err))
        queryClient.clear()
      },
    },
    guards: {
      hadActiveSession: ({ context }) => context.user !== null || context.dbUser !== null,
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
