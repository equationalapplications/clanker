import { createMachine, assign, fromPromise, ActorRefFrom } from 'xstate'
import { supabaseClient } from '~/config/supabaseClient'
import { APP_NAME } from '~/config/constants'
import { TERMS } from '~/config/termsConfig'

const checkTermsAcceptance = async (
  userId: string,
): Promise<{ accepted: boolean; isUpdate: boolean }> => {
  const { data, error } = await supabaseClient
    .from('user_app_subscriptions')
    .select('terms_accepted_at, terms_version')
    .eq('user_id', userId)
    .eq('app_name', APP_NAME)
    .maybeSingle()

  if (error) throw error
  if (!data || !data.terms_accepted_at) return { accepted: false, isUpdate: false }
  if (data.terms_version !== TERMS.version) return { accepted: false, isUpdate: true }
  return { accepted: true, isUpdate: false }
}

const recordTermsAcceptance = async (userId: string): Promise<void> => {
  const now = new Date().toISOString()

  const { data: existingSubscription, error: readError } = await supabaseClient
    .from('user_app_subscriptions')
    .select('user_id')
    .eq('user_id', userId)
    .eq('app_name', APP_NAME)
    .maybeSingle()

  if (readError) throw readError

  if (!existingSubscription) {
    throw new Error('Missing subscription row for terms acceptance')
  }

  const { error: updateError } = await supabaseClient
    .from('user_app_subscriptions')
    .update({
      terms_accepted_at: now,
      terms_version: TERMS.version,
      updated_at: now,
    })
    .eq('user_id', userId)
    .eq('app_name', APP_NAME)

  if (updateError) throw updateError
}

export interface TermsMachineContext {
  supabaseUserId: string | null
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
      supabaseUserId: null,
      isUpdate: false,
      error: null,
    } as TermsMachineContext,
    on: {
      AUTH_STATE_CHANGED: [
        {
          target: '.checking',
          guard: ({ event }) => event.authState.matches('signedIn'),
          actions: assign({
            supabaseUserId: ({ event }) =>
              event.authState.context.supabaseSession?.user?.id ?? null,
          }),
        },
        {
          target: '.idle',
          actions: assign({ supabaseUserId: null, isUpdate: false, error: null }),
        },
      ],
    },
    states: {
      idle: {},
      checking: {
        invoke: {
          id: 'checkTerms',
          src: 'checkTermsAcceptance',
          input: ({ context }) => ({ userId: context.supabaseUserId }),
          onDone: [
            {
              target: 'accepted',
              guard: ({ event }) => event.output.accepted === true,
              actions: assign({ isUpdate: false, error: null }),
            },
            {
              target: 'acceptanceRequired',
              actions: assign({
                isUpdate: ({ event }) => event.output.isUpdate,
                error: null,
              }),
            },
          ],
          onError: {
            target: 'acceptanceRequired',
            actions: assign({ error: ({ event }) => event.error as Error }),
          },
        },
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
          input: ({ context }) => ({ userId: context.supabaseUserId }),
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
      checkTermsAcceptance: fromPromise(async ({ input }) => {
        const { userId } = input as { userId: string | null }
        if (!userId) throw new Error('User not logged in')
        return checkTermsAcceptance(userId)
      }),
      recordTermsAcceptance: fromPromise(async ({ input }) => {
        const { userId } = input as { userId: string | null }
        if (!userId) throw new Error('User not logged in')
        return recordTermsAcceptance(userId)
      }),
    },
  },
)

export type TermsMachineActor = ActorRefFrom<typeof termsMachine>
