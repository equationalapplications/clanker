import { createMachine, assign, fromPromise, fromCallback } from 'xstate';
import { FirebaseUser as User, onAuthStateChanged, signOut as firebaseSignOut } from '~/config/firebaseConfig';
import { supabaseClient as supabase } from '~/config/supabaseClient';

import { signInWithGoogle, GoogleSignInResult } from '~/auth/googleSignin';
import { signInWithApple, AppleSignInResult } from '~/auth/appleSignin';

// Placeholder for a function to get Supabase session
const getSupabaseUserSession = async (token: string) => {
    const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'firebase',
        token,
    });
    if (error) throw error;
    return data.session;
};

// Placeholder for RevenueCat login
const loginRevenueCat = async (userId: string) => {
    console.log(`RevenueCat: Logging in ${userId}`);
    return;
};

// Placeholder for Crashlytics user ID
const setCrashlyticsUserId = (userId: string | null) => {
    console.log(`Crashlytics: Setting user ID to ${userId}`);
};

export interface AuthMachineContext {
    user: User | null;
    supabaseSession: any | null;
    error: Error | null;
}

export type AuthMachineEvents =
    | { type: 'USER_FOUND'; user: User }
    | { type: 'NO_USER_FOUND' }
    | { type: 'SIGN_IN'; provider: 'google' | 'apple' }
    | { type: 'SIGN_OUT' }
    | { type: 'TOKEN_EXCHANGE_SUCCESS'; session: any }
    | { type: 'TOKEN_EXCHANGE_FAILURE'; error: Error }
    | { type: 'REFRESH_TOKEN' }
    | { type: 'SIGN_IN_SUCCESS'; user: User }
    | { type: 'SIGN_IN_FAILURE'; error: Error };

export const authMachine = createMachine({
    id: 'authMachine',
    types: {} as {
        context: AuthMachineContext,
        events: AuthMachineEvents,
    },
    initial: 'initializing',
    context: {
        user: null,
        supabaseSession: null,
        error: null,
    } as AuthMachineContext,
    states: {
        initializing: {
            invoke: {
                id: 'listenToAuthState',
                src: 'listenToAuthState',
                onDone: {
                    target: 'signedOut',
                },
            },
            on: {
                USER_FOUND: {
                    target: 'exchangingToken',
                    actions: assign({ user: ({ event }) => event.user }),
                },
                NO_USER_FOUND: {
                    target: 'signedOut',
                },
            },
        },
        signedOut: {
            entry: assign({ user: null, supabaseSession: null, error: null }),
            on: {
                SIGN_IN: 'signingIn',
            },
        },
        signingIn: {
            invoke: {
                id: 'signInProvider',
                src: 'signInProvider',
                input: ({ event }) => ({ provider: (event as any).provider }),
                onDone: {
                    target: 'exchangingToken',
                    actions: assign({ user: ({ event }) => (event.output as any) as User | null }),
                },
                onError: {
                    target: 'signedOut',
                    actions: assign({ error: ({ event }) => (event.error as Error) }),
                },
            },
        },
        exchangingToken: {
            invoke: {
                id: 'exchangeFirebaseToken',
                src: 'exchangeFirebaseToken',
                onDone: {
                    target: 'signedIn',
                    actions: assign({ supabaseSession: ({ event }) => event.output }),
                },
                onError: {
                    target: 'signedOut',
                    actions: assign({ error: ({ event }) => (event.error as Error) }),
                },
            },
        },
        signedIn: {
            initial: 'idle',
            entry: [
                ({ context }) => loginRevenueCat(context.user!.uid),
                ({ context }) => setCrashlyticsUserId(context.user!.uid),
            ],
            on: {
                SIGN_OUT: 'signingOut',
            },
            states: {
                idle: {
                    after: {
                        // Refresh token 5 minutes before expiry
                        TOKEN_EXPIRY_DELAY: { target: 'refreshingToken' },
                    },
                },
                refreshingToken: {
                    invoke: {
                        id: 'refreshSupabaseToken',
                        src: 'refreshSupabaseToken',
                        onDone: {
                            target: 'idle',
                            actions: assign({ supabaseSession: ({ event }) => event.output }),
                        },
                        onError: {
                            target: '#authMachine.signingOut',
                            actions: assign({ error: ({ event }) => (event.error as Error) }),
                        },
                    },
                },
            },
        },
        signingOut: {
            invoke: {
                id: 'signOut',
                src: 'signOut',
                onDone: {
                    target: 'signedOut',
                },
                onError: {
                    // Even if signout fails, go to signed out state
                    target: 'signedOut',
                    actions: assign({ error: ({ event }) => (event.error as Error) }),
                },
            },
        },
    },
}, {
    actions: {},
    actors: {
        listenToAuthState: fromCallback(({ sendBack }) => {
            const unsubscribe = onAuthStateChanged((user) => {
                if (user) {
                    sendBack({ type: 'USER_FOUND', user });
                } else {
                    sendBack({ type: 'NO_USER_FOUND' });
                }
            });
            return unsubscribe;
        }),
        signInProvider: fromPromise(async ({ input }) => {
            const { provider } = input as { provider: 'google' | 'apple' };
            let result: GoogleSignInResult | AppleSignInResult;
            if (provider === 'google') {
                result = await signInWithGoogle();
            } else if (provider === 'apple') {
                result = await signInWithApple();
            } else {
                throw new Error('Unsupported provider');
            }

            if (!result.success) {
                throw new Error(result.error || 'Sign-in failed');
            }
            // This relies on onAuthStateChanged to fire with the new user
            return;
        }),
        exchangeFirebaseToken: fromPromise(async ({ input }) => {
            const { user } = input as { user: User | null };
            if (!user) throw new Error('No user to exchange token for');
            const token = await user.getIdToken();
            return getSupabaseUserSession(token);
        }),
        refreshSupabaseToken: fromPromise(async ({ input }) => {
            const { user } = input as { user: User | null };
            if (!user) throw new Error('No user to refresh token for');
            const token = await user.getIdToken(true); // Force refresh
            return getSupabaseUserSession(token);
        }),
        signOut: fromPromise(async () => {
            await firebaseSignOut();
            await supabase.auth.signOut();
            setCrashlyticsUserId(null);
            // any other cleanup
        }),
    },
    guards: {},
    delays: {
        TOKEN_EXPIRY_DELAY: ({ context }) => {
            const session = context.supabaseSession;
            if (!session || !session.expires_at) {
                // Default to a long time if no session or expiry
                return 3600 * 1000;
            }
            const expiresIn = session.expires_at * 1000 - Date.now();
            // 5 minutes buffer
            const fiveMinutes = 5 * 60 * 1000;
            return Math.max(0, expiresIn - fiveMinutes);
        }
    }
});
