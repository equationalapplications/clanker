import { createMachine, assign, fromPromise, ActorRefFrom } from 'xstate'
import { TERMS } from '~/config/termsConfig'
import { acceptTermsFn } from '~/services/apiClient'
import { logEvent } from '~/services/analyticsService'
import { Storage } from '~/utilities/kvStorage'
import type { SubscriptionSnapshot } from '~/auth/bootstrapSession'

export interface TermsMachineContext {
  subscription: SubscriptionSnapshot | null
  isUpdate: boolean
  error: Error | null
  // Session fallback for a decline whose KV record could not be persisted: the window end
  // carried by DECLINE_TERMS. Unlike a bare boolean it expires with the window, so an
  // in-session re-check after the window resumes blocking without an app restart.
  declinedUntil: string | null
}

export type TermsMachineEvents =
  | { type: 'AUTH_STATE_CHANGED'; authState: any }
  | { type: 'ACCEPT_TERMS'; isUpdate?: boolean }
  | { type: 'DECLINE_TERMS'; windowEnd: string }
  | { type: 'REJECT_TERMS' }

// Terms declined (ToS §12.19 option [B], notice-then-enforce): a declining user keeps access
// under the previously accepted Terms until the end of the period they already paid for. The
// decline record is deliberately NOT an acceptance — subscription.termsVersion stays stale, so
// once the suppression window ends the normal version check re-prompts and accepting is required
// to renew. The window is derived from subscription.nextExpiryDate when billing provides one,
// else a 24h fallback from decline (documented approximation — see issue #810). The shared
// decline-notice helper (window derivation, record, event, notice copy) lives in
// src/utilities/termsDecline.ts, used by both decline-notice callers.
const TERMS_DECLINE_KEY = 'terms:declined'

interface TermsDeclineRecord {
  termsVersion: string
  declinedAt: string
  suppressUntil: string
}

function hasActiveDecline(): boolean {
  try {
    const raw = Storage.getItemSync(TERMS_DECLINE_KEY)
    if (!raw) return false
    const record = JSON.parse(raw) as Partial<TermsDeclineRecord> | null
    if (
      !record ||
      record.termsVersion !== TERMS.version ||
      typeof record.suppressUntil !== 'string'
    ) {
      return false
    }
    const suppressUntil = Date.parse(record.suppressUntil)
    return !Number.isNaN(suppressUntil) && suppressUntil > Date.now()
  } catch {
    return false
  }
}

// Session-only fallback window (see TermsMachineContext.declinedUntil). NaN parses fail closed.
function hasActiveSessionDecline(context: TermsMachineContext): boolean {
  return context.declinedUntil !== null && Date.parse(context.declinedUntil) > Date.now()
}

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
      declinedUntil: null,
    } as TermsMachineContext,
    on: {
      AUTH_STATE_CHANGED: [
        {
          target: '.checking',
          guard: ({ event }) => event.authState.matches('signedIn'),
          actions: assign({
            subscription: ({ event }) => event.authState.context.subscription ?? null,
          }),
        },
        {
          target: '.idle',
          actions: assign({
            subscription: null,
            isUpdate: false,
            error: null,
            declinedUntil: null,
          }),
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
              return (
                sub !== null && sub.termsVersion === TERMS.version && sub.termsAcceptedAt !== null
              )
            },
            actions: assign({ isUpdate: false, error: null, declinedUntil: null }),
          },
          {
            target: 'accepted',
            // Declined-not-accepted: suppress the blocking surface while the active decline
            // window runs (paid period end, or the 24h fallback) — either the persisted
            // record or the session fallback window governs, and both expire with the
            // window. The stored termsVersion stays stale, so the next check after the
            // window resumes blocking without an app restart.
            guard: ({ context }) => hasActiveDecline() || hasActiveSessionDecline(context),
            actions: assign({ isUpdate: false, error: null }),
          },
          {
            target: 'acceptanceRequired',
            actions: assign({
              isUpdate: ({ context }) => {
                const sub = context.subscription
                // If they accepted a previous version, it's an update
                return (
                  sub !== null && sub.termsVersion !== null && sub.termsVersion !== TERMS.version
                )
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
          DECLINE_TERMS: {
            target: 'accepted',
            // 'accepted' here means "not blocked right now" — the decline record keeps
            // subscription.termsVersion untouched (still the stale prior version), so
            // enforcement resumes at the next acceptance check after the window ends.
            // windowEnd seeds the session fallback in case the KV record failed to persist.
            actions: assign({
              declinedUntil: ({ event }) => event.windowEnd,
              error: null,
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
            // A real acceptance supersedes any session decline window.
            actions: [assign({ declinedUntil: null }), 'logTermsAccepted'],
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
    actions: {
      logTermsAccepted: ({ context }: { context: TermsMachineContext }) => {
        logEvent('terms_accepted', { is_update: context.isUpdate })
      },
    },
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

/**
 * Persist a decline (best-effort, sync KV): records that the current Terms version was declined
 * at this moment and until when the blocking surface should stay suppressed. windowEnd comes
 * from the subscription's current period end when billing provides one, else 24h from now.
 */
export function recordTermsDecline(windowEnd: string, declinedAt: Date = new Date()): void {
  try {
    const record: TermsDeclineRecord = {
      termsVersion: TERMS.version,
      declinedAt: declinedAt.toISOString(),
      suppressUntil: windowEnd,
    }
    Storage.setItemSync(TERMS_DECLINE_KEY, JSON.stringify(record))
  } catch {
    // Best-effort: if persistence fails, decline behaves like a session-only grace — the
    // in-memory declinedUntil window still suppresses until it expires, and blocking resumes
    // at the next acceptance check after that (or on next launch) rather than erroring.
  }
}

export function clearTermsDecline(): void {
  try {
    Storage.setItemSync(TERMS_DECLINE_KEY, '')
  } catch {
    // Best-effort, same contract as recordTermsDecline.
  }
}

export type TermsMachineActor = ActorRefFrom<typeof termsMachine>
