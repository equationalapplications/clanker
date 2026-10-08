import { createMachine, assign, fromPromise, ActorRefFrom } from 'xstate'
import { TERMS } from '~/config/termsConfig'
import { acceptTermsFn } from '~/services/apiClient'
import { logEvent } from '~/services/analyticsService'
import { Storage } from '~/utilities/kvStorage'
import type { SubscriptionSnapshot } from '~/auth/bootstrapSession'

export interface TermsMachineContext {
  subscription: SubscriptionSnapshot | null
  // Identity the decline record is scoped to (finding: Firebase can emit signedIn→signedIn
  // on an account switch without a signedOut branch run, so the record must carry the uid
  // it was recorded under to not leak the suppression window to a different account).
  userUid: string | null
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

// Fallback re-check cadence when a 'declined' window cannot be parsed into a delay.
const TERMS_DECLINE_RECHECK_DELAY_MS = 60_000

// setTimeout (browsers and React Native) treats a delay above the 32-bit signed limit as
// overflow and fires ~immediately. A paid period can end more than ~24.8 days out (annual
// plans), so the 'declined' after-delay is capped at the limit: each wake-up re-checks in
// 'checking' and re-schedules for the remaining time instead of spinning the re-check loop
// (CodeRabbit round on PR #812).
const MAX_TIMER_DELAY_MS = 2_147_483_647

interface TermsDeclineRecord {
  uid: string | null
  termsVersion: string
  declinedAt: string
  suppressUntil: string
}

// Returns the persisted decline record only when it is active (current version, still inside
// its suppression window) AND was recorded for `uid` — an account switch that never passes
// through signedOut must not inherit the previous account's window.
function activeDeclineRecord(uid: string | null): TermsDeclineRecord | null {
  try {
    const raw = Storage.getItemSync(TERMS_DECLINE_KEY)
    if (!raw) return null
    const record = JSON.parse(raw) as Partial<TermsDeclineRecord> | null
    if (
      !record ||
      record.uid !== uid ||
      record.termsVersion !== TERMS.version ||
      typeof record.suppressUntil !== 'string'
    ) {
      return null
    }
    const suppressUntil = Date.parse(record.suppressUntil)
    return Number.isNaN(suppressUntil) || suppressUntil <= Date.now()
      ? null
      : (record as TermsDeclineRecord)
  } catch {
    return null
  }
}

function hasActiveDecline(uid: string | null): boolean {
  return activeDeclineRecord(uid) !== null
}

// Session-only fallback window (see TermsMachineContext.declinedUntil). NaN parses fail closed.
function hasActiveSessionDecline(context: TermsMachineContext): boolean {
  return context.declinedUntil !== null && Date.parse(context.declinedUntil) > Date.now()
}

// Identity carried by an AUTH_STATE_CHANGED event: the Firebase uid when present, else the
// backend dbUser id.
function authStateUid(event: { authState: any }): string | null {
  return (event.authState.context.user?.uid ?? event.authState.context.dbUser?.id ?? null) as
    string | null
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
      userUid: null,
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
            userUid: ({ event }) => authStateUid(event),
            // The session decline window is account-scoped like the record: a same-account
            // re-check keeps it, but an account switch that arrives as signedIn→signedIn
            // (no signedOut branch run) must not inherit the previous account's window.
            declinedUntil: ({ context, event }) =>
              authStateUid(event) === context.userUid ? context.declinedUntil : null,
          }),
        },
        {
          target: '.idle',
          // Sign-out also drops the persisted decline record: it must not leak the
          // suppression window to a different account on the same device. Gated to an
          // actual signedOut — NOT every non-signedIn state: the auth machine boots in
          // 'initializing' and that first snapshot is always forwarded, so clearing here
          // unconditionally wiped the record on every launch (PR #812 review).
          guard: ({ event }) => event.authState.matches('signedOut'),
          actions: [
            assign({
              subscription: null,
              userUid: null,
              isUpdate: false,
              error: null,
              declinedUntil: null,
            }),
            'clearDeclineRecord',
          ],
        },
        {
          // Transient non-signedIn states (initializing, signingIn, bootstrapping — which
          // also covers a foreground/bootstrap refresh — and signingOut): wait in idle and
          // keep the decline record AND the account-scoped session window. The next
          // signedIn event keeps the window only for the same uid.
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
              return (
                sub !== null && sub.termsVersion === TERMS.version && sub.termsAcceptedAt !== null
              )
            },
            actions: assign({ isUpdate: false, error: null, declinedUntil: null }),
          },
          {
            // 'declined' (NOT 'accepted'): the UI effects treat 'accepted' as a real
            // acceptance (record the new version), which would launder a decline into one.
            target: 'declined',
            // Declined-not-accepted: suppress the blocking surface while the active decline
            // window runs (paid period end, or the 24h fallback) — either the persisted
            // record or the session fallback window governs, and both expire with the
            // window. The stored termsVersion stays stale, so the next check after the
            // window resumes blocking without an app restart.
            // Session window first: it is in memory, so the sync KV read is skipped
            // whenever it already governs.
            guard: ({ context }) =>
              hasActiveSessionDecline(context) || hasActiveDecline(context.userUid),
            actions: assign({
              isUpdate: false,
              error: null,
              // Seed the session window from the persisted record so the 'declined'
              // after-delay can schedule the re-check when no session decline seeded it.
              declinedUntil: ({ context }) =>
                context.declinedUntil ??
                activeDeclineRecord(context.userUid)?.suppressUntil ??
                null,
            }),
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
            // 'declined' (NOT 'accepted'): the layout/screen effects treat 'accepted' as a
            // real acceptance — targeting it here would clear the decline record and record
            // the new Terms version as accepted. 'declined' keeps subscription.termsVersion
            // untouched (still the stale prior version), so enforcement resumes at the next
            // acceptance check after the window ends. windowEnd seeds the session fallback
            // in case the KV record failed to persist.
            target: 'declined',
            actions: assign({
              declinedUntil: ({ event }) => event.windowEnd,
              error: null,
            }),
          },
        },
      },
      accepting: {
        on: {
          // A decline that arrives while the acceptance write is in flight is consumed in
          // place (no re-entry, the invoked write keeps running): the write resolves on
          // its own — accepted on success, re-prompted on failure. The cancel button is
          // disabled during accepting, so this only guards non-UI senders; consuming the
          // event explicitly documents the drop instead of relying on XState's implicit
          // swallowing.
          DECLINE_TERMS: { reenter: false },
        },
        invoke: {
          id: 'recordTermsAcceptance',
          src: 'recordTermsAcceptance',
          onDone: {
            target: 'accepted',
            // A real acceptance supersedes any decline window AND record — cleared here at
            // the machine level (not only via the layout effect) so a stale record can
            // never suppress re-blocking after acceptance (review thread on PR #811).
            actions: [assign({ declinedUntil: null }), 'clearDeclineRecord', 'logTermsAccepted'],
          },
          onError: {
            target: 'acceptanceRequired',
            actions: assign({ error: ({ event }) => event.error as Error }),
          },
        },
      },
      accepted: {},
      // Declined-not-accepted (notice-then-enforce): resting "not blocked" state that is
      // deliberately distinct from 'accepted' so decline never reaches the UI effects that
      // record a real acceptance.
      declined: {
        // Expiry is NOT keyed to auth events (finding: an app left open would rest here past
        // windowEnd indefinitely). Re-run the acceptance check when the suppression window
        // ends — 'checking' re-evaluates and lands in acceptanceRequired (or 'declined'
        // again with a fresh delay if a still-active record governs).
        after: { declineWindowExpiry: { target: 'checking' } },
      },
    },
  },
  {
    delays: {
      // Milliseconds until the suppression window ends; an unparseable window re-checks on
      // a short poll rather than never (both window sources are ISO strings in practice).
      declineWindowExpiry: ({ context }) => {
        const end = context.declinedUntil ? Date.parse(context.declinedUntil) : NaN
        if (Number.isNaN(end)) return TERMS_DECLINE_RECHECK_DELAY_MS
        return Math.min(MAX_TIMER_DELAY_MS, Math.max(0, end - Date.now()))
      },
    },
    actions: {
      clearDeclineRecord: () => {
        clearTermsDecline()
      },
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
 * at this moment by `uid` and until when the blocking surface should stay suppressed. windowEnd
 * comes from the subscription's current period end when billing provides one, else 24h from now.
 */
export function recordTermsDecline(
  windowEnd: string,
  uid: string | null,
  declinedAt: Date = new Date(),
): void {
  try {
    const record: TermsDeclineRecord = {
      uid,
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
