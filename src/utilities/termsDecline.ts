import type { SubscriptionSnapshot } from '~/auth/bootstrapSession'
import type { TermsMachineActor } from '~/machines/termsMachine'
import { recordTermsDecline } from '~/machines/termsMachine'
import { showAlert } from '~/utilities/showAlert'

// Shared decline-notice handler (ToS §12.19 option [B], notice-then-enforce, issue #810).
// Both decline surfaces — the drawer gate in app/(drawer)/_layout.tsx and the standalone
// accept-terms screen — must derive the suppression window, record the decline, unblock,
// and show the SAME notice, so the rule lives here once instead of drifting between callers.

// Documented approximation (issue #810): when billing provides no period end, suppression
// runs 24h from the decline.
export const TERMS_DECLINE_FALLBACK_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Suppression-window end for a decline: the subscription's current period end when billing
 * provides a future one, else the 24h fallback from `now`.
 */
export function termsDeclineWindowEnd(
  subscription: SubscriptionSnapshot | null,
  now: Date = new Date(),
): string {
  const periodEnd = subscription?.nextExpiryDate ?? null
  const parsed = periodEnd ? Date.parse(periodEnd) : NaN
  return !Number.isNaN(parsed) && parsed > now.getTime()
    ? (periodEnd as string)
    : new Date(now.getTime() + TERMS_DECLINE_FALLBACK_WINDOW_MS).toISOString()
}

/**
 * Decline = notice-then-enforce (issue #810): the user is NOT signed out and keeps access
 * under the previously accepted Terms. Records declined-not-accepted (subscription.termsVersion
 * is untouched) so the blocking surface resumes at the next acceptance check after the paid
 * period ends (24h fallback when billing gives no period end), then shows the decline notice.
 */
export function handleTermsDecline(termsService: TermsMachineActor): void {
  const subscription = termsService.getSnapshot().context.subscription
  const now = new Date()
  const windowEnd = termsDeclineWindowEnd(subscription, now)
  recordTermsDecline(windowEnd, now)
  termsService.send({ type: 'DECLINE_TERMS', windowEnd })
  showAlert(
    'Terms declined',
    "You can keep using Clanker under the previous Terms until the end of the period you've already paid for. Your next renewal requires accepting the updated Terms — you can also cancel before renewal in your account or store settings.",
  )
}
