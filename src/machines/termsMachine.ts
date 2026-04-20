import { createMachine, assign, fromPromise, ActorRefFrom } from 'xstate'
import { TERMS } from '~/config/termsConfig'
import { acceptTermsFn } from '~/services/apiClient'
import type { SubscriptionSnapshot } from '~/auth/bootstrapSession'

export interface TermsMachineContext {
  subscription: SubscriptionSnapshot | null
  isUpdate: boolean
  error: Error | null
}

export type TermsMachineEvents =
  | { type: 'AUTH_STATE_CHANGED'; authState: any }
  | { type: 'ACCEPT_TERMS'; isUpdate?: boolean }
  | { type: 'REJECT_TERMS' }

export const termsMachine = createMachine(
  {
    id: 'termsMachine',
    types: {} as {
      context: TermsMachineContext
      events: TermsMachineEvents
    },
    initial: 'idle',
    context: {
      subscription: null,
      isUpdate: false,
      error: null,
    } as TermsMachineContext,
    on: {
      AUTH_STATE_CHANGED: [
        {
          target: '.checking',
          guard: ({ event }) => event.authState.matches('signedIn'),
          actions: assign({
            subscription: ({ event }) =>
              event.authState.context.subscription ?? null,
          }),
        },
        {
          target: '.idle',
          actions: assign({ subscription: null, isUpdate: false, error: null }),
        },
      ],
    },
    states: {
      idle: {},
      checking: {
        always: [
          {
            target: 'accepted',
            guard: ({ context }) => {
              const sub = context.subscription
              return sub !== null && sub.termsVersion === TERMS.version && sub.termsAcceptedAt !== null
            },
            actions: assign({ isUpdate: false, error: null }),
          },
          {
            target: 'acceptanceRequired',
            actions: assign({
              isUpdate: ({ context }) => {
                const sub = context.subscription
                // If they accepted a previous version, it's an update
                return sub !== null && sub.termsVersion !== null && sub.termsVersion !== TERMS.version
              },
              error: null,
            }),
          },
        ],
      },
      acceptanceRequired: {
        on: {
          ACCEPT_TERMS: {
            target: 'accepting',
            actions: assign({ error: null }),
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
            actions: assign({ error: ({ event }) => event.error as Error }),
          },
        },
      },
      accepted: {},
    },
  },
  {
    actors: {
      recordTermsAcceptance: fromPromise(async () => {
        try {
          const response = await acceptTermsFn({ termsVersion: TERMS.version })
          if (response?.data?.success !== true) {
            throw new Error('Malformed accept terms response')
          }
        } catch (err: any) {
          throw new Error('Failed to record terms acceptance: ' + err.message)
        }
      }),
    },
  },
)

export type TermsMachineActor = ActorRefFrom<typeof termsMachine>
