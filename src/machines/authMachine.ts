import { createMachine, assign, fromPromise, fromCallback } from 'xstate';
import { FirebaseUser as User, onAuthStateChanged, signOut as firebaseSignOut } from '~/config/firebaseConfig';
import { supabaseClient as supabase } from '~/config/supabaseClient';
import { Platform } from 'react-native';

import { signInWithGoogle, GoogleSignInResult, signOutFromGoogle } from '~/auth/googleSignin';
import { signInWithApple, AppleSignInResult, signOutFromApple } from '~/auth/appleSignin';
import { getSupabaseUserSession } from '~/auth/getSupabaseUserSession';
import { loginRevenueCat, logoutRevenueCat } from '~/config/revenueCatConfig';
import { setCrashlyticsUserId } from '~/services/crashlyticsService';
import { queryClient } from '~/config/queryClient';

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
    invoke: {
        id: 'listenToAuthState',
        src: 'listenToAuthState',
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
    states: {
        initializing: {},
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
                onError: {
                    target: 'signedOut',
                    actions: assign({ error: ({ event }) => (event.error as Error) }),
                },
            },
            // USER_FOUND from the top-level listener will drive the transition to exchangingToken
        },
        exchangingToken: {
            invoke: {
                id: 'exchangeFirebaseToken',
                src: 'exchangeFirebaseToken',
                input: ({ context }) => ({ user: context.user }),
                onDone: {
                    target: 'establishingSupabaseSession',
                },
                onError: {
                    target: 'signedOut',
                    actions: assign({ error: ({ event }) => (event.error as Error) }),
                },
            },
        },
        establishingSupabaseSession: {
            invoke: {
                id: 'establishSupabaseSession',
                src: fromPromise(async ({ input }) => {
                    const authResponse = await supabase.auth.setSession({
                        access_token: input.access_token,
                        refresh_token: input.refresh_token,
                    });

                    if (authResponse.error) {
                        throw authResponse.error;
                    }

                    return authResponse.data.session;
                }),
                input: ({ context, event }) => {
                    // This input is for the onDone event of exchangeFirebaseToken
                    const exchangeResponse = (event as any).output as {
                        access_token: string;
                        refresh_token: string;
                    };

                    return {
                        access_token: exchangeResponse.access_token,
                        refresh_token: exchangeResponse.refresh_token,
                    };
                },
                onDone: {
                    target: 'signedIn',
                    actions: assign({
                        supabaseSession: ({ event }) => event.output,
                        user: ({ event }) => ({ ...event.output.user }),
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
                        input: ({ context }) => ({ user: context.user }),
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
            on: {
                // While signing out, we want to ignore auth state changes
                // until the sign out process is complete.
                USER_FOUND: undefined,
                NO_USER_FOUND: undefined,
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
            return getSupabaseUserSession();
        }),
        refreshSupabaseToken: fromPromise(async ({ input }) => {
            const { user } = input as { user: User | null };
            if (!user) throw new Error('No user to refresh token for');
            // Force-refresh the Firebase token before calling exchangeToken
            await user.getIdToken(true);
            return getSupabaseUserSession();
        }),
        signOut: fromPromise(async () => {
            await firebaseSignOut();
            await supabase.auth.signOut();
            await setCrashlyticsUserId(null);
            await logoutRevenueCat();
            if (Platform.OS === 'ios') {
                await signOutFromApple();
            } else if (Platform.OS === 'android') {
                await signOutFromGoogle();
            } else {
                await signOutFromGoogle();
            }
            queryClient.clear();
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
