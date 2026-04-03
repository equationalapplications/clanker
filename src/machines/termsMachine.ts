import { createMachine, assign, fromPromise } from 'xstate';
import { ActorRefFrom } from 'xstate';
import { authMachine } from './authMachine';

// This is a placeholder for the actual check
// In reality, this would check a database or a local cache
const checkTermsAcceptance = async (userId: string): Promise<boolean> => {
    console.log(`Checking terms for ${userId}`);
    // Simulate a network request
    await new Promise(resolve => setTimeout(resolve, 500));
    // In a real app, you'd have logic to determine this.
    // For now, let's assume they always need to accept.
    return false;
};

const recordTermsAcceptance = async (userId: string): Promise<void> => {
    console.log(`Recording terms acceptance for ${userId}`);
    await new Promise(resolve => setTimeout(resolve, 500));
}

export interface TermsMachineContext {
    userId: string | null;
    isUpdate: boolean;
    error: Error | null;
}

export type TermsMachineEvents =
    | { type: 'AUTH_STATE_CHANGED'; authState: any }
    | { type: 'ACCEPT_TERMS'; isUpdate?: boolean }
    | { type: 'REJECT_TERMS' };

export const termsMachine = createMachine({
    id: 'termsMachine',
    types: {} as {
        context: TermsMachineContext,
        events: TermsMachineEvents,
    },
    initial: 'idle',
    context: {
        userId: null,
        isUpdate: false,
        error: null,
    } as TermsMachineContext,
    on: {
        AUTH_STATE_CHANGED: [
            {
                target: '.checking',
                guard: ({ event }) => event.authState.matches('signedIn'),
                actions: assign({
                    userId: ({ event }) => event.authState.context.user?.uid,
                }),
            },
            {
                target: '.idle',
                actions: assign({ userId: null }),
            },
        ],
    },
    states: {
        idle: {},
        checking: {
            invoke: {
                id: 'checkTerms',
                src: 'checkTermsAcceptance',
                onDone: [
                    {
                        target: 'accepted',
                        guard: ({ event }) => event.output === true,
                    },
                    {
                        target: 'acceptanceRequired',
                    },
                ],
                onError: {
                    // Handle error, maybe retry or go to an error state
                    target: 'idle',
                },
            },
        },
        acceptanceRequired: {
            on: {
                ACCEPT_TERMS: {
                    target: 'accepting',
                    actions: assign({
                        isUpdate: ({ event }) => event.isUpdate ?? false,
                    }),
                },
            },
        },
        accepting: {
            invoke: {
                id: 'recordTermsAcceptance',
                src: 'recordTermsAcceptance',
                onDone: {
                    target: 'accepted',
                },
                onError: {
                    target: 'acceptanceRequired',
                    actions: assign({ error: ({ event }) => (event.error as Error) }),
                },
            },
        },
        accepted: {},
    },
}, {
    actors: {
        checkTermsAcceptance: fromPromise(async ({ input }) => {
            const { userId } = input as { userId: string | null };
            if (!userId) throw new Error("User not logged in");
            return checkTermsAcceptance(userId);
        }),
        recordTermsAcceptance: fromPromise(async ({ input }) => {
            const { userId } = input as { userId: string | null };
            if (!userId) throw new Error("User not logged in");
            return recordTermsAcceptance(userId);
        })
    }
});

export type TermsMachineActor = ActorRefFrom<typeof termsMachine>;
