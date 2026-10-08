import type { SubscriptionSnapshot } from '~/auth/bootstrapSession'
import type { AuthMachineActor } from '~/machines/authMachine'
import type { TermsMachineActor } from '~/machines/termsMachine'
import { recordTermsDecline } from '~/machines/termsMachine'
import { logEvent } from '~/services/analyticsService'
import { showAlert } from '~/utilities/showAlert'

// Shared decline-notice handler (ToS §12.19 option [B], notice-then-enforce, issue #810).
// Both decline surfaces — the drawer gate in app/(drawer)/_layout.tsx and the standalone
// accept-terms screen — must derive the suppression window, record the decline, unblock,
// and show the SAME notice, so the rule lives here once instead of drifting between callers.

// Documented approximation (issue #810): when billing provides no period end, suppression
// runs 24h from the decline.
export const TERMS_DECLINE_FALLBACK_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Whether billing provides a future period end for the suppression window. The decline
 * notice says "until the end of the period you've already paid for" ONLY when this is
 * true — otherwise the window is the 24h fallback and the copy must say so.
 */
export function termsDeclineUsesPaidPeriod(
  subscription: SubscriptionSnapshot | null,
  now: Date = new Date(),
): boolean {
  const periodEnd = subscription?.nextExpiryDate ?? null
  const parsed = periodEnd ? Date.parse(periodEnd) : NaN
  return !Number.isNaN(parsed) && parsed > now.getTime()
}

/**
 * Suppression-window end for a decline: the subscription's current period end when billing
 * provides a future one, else the 24h fallback from `now`.
 */
export function termsDeclineWindowEnd(
  subscription: SubscriptionSnapshot | null,
  now: Date = new Date(),
): string {
  if (termsDeclineUsesPaidPeriod(subscription, now)) {
    return subscription?.nextExpiryDate as string
  }
  return new Date(now.getTime() + TERMS_DECLINE_FALLBACK_WINDOW_MS).toISOString()
}

/**
 * Decline = notice-then-enforce (issue #810): the user is NOT signed out and keeps access
 * under the previously accepted Terms. Records declined-not-accepted (subscription.termsVersion
 * is untouched) so the blocking surface resumes at the next acceptance check after the paid
 * period ends (24h fallback when billing gives no period end), then shows the decline notice.
 * The notice names the ACTUAL window — the paid period when billing provides one, else the
 * 24h fallback — so the copy never over-promises.
 */
export function handleTermsDecline(termsService: TermsMachineActor): void {
  const context = termsService.getSnapshot().context
  const now = new Date()
  const paidPeriod = termsDeclineUsesPaidPeriod(context.subscription, now)
  const windowEnd = termsDeclineWindowEnd(context.subscription, now)
  recordTermsDecline(windowEnd, context.userUid, now)
  termsService.send({ type: 'DECLINE_TERMS', windowEnd })
  // Telemetry for the legally significant decline path (issue #810 follow-ups: decline
  // rate, how often the 24h fallback governs, re-enforcement after the window).
  logEvent('terms_declined', { window: paidPeriod ? 'paid_period' : 'fallback_24h' })
  showAlert(
    'Terms declined',
    paidPeriod
      ? "You can keep using Clanker under the previous Terms until the end of the period you've already paid for. Your next renewal requires accepting the updated Terms — you can also cancel before renewal in your account or store settings."
      : 'You can keep using Clanker under the previous Terms for the next 24 hours. After that, accepting the updated Terms is required to continue — you can also cancel before renewal in your account or store settings.',
  )
}

// First Terms version that can only have been accepted through the age gate. The gate shipped
// while TERMS.version (termsConfig.ts) was '2.4', and 2.4 was also accepted by pre-gate accounts,
// so the next bump ('2.5') is the first trusted version. Deliberately NOT bumped here: forcing
// every account to re-accept is a product/legal call. Until the next Terms bump, 2.4 accounts stay
// accepted; on that bump they run the age check (post-gate 2.4 signups are re-checked too, which
// is redundant but fail-safe).
export const FIRST_AGE_GATED_TERMS_VERSION = '2.5'

// Compares [major, minor] numerically. Accepts only complete, recognized terms-version
// values (e.g. "2.5", "2.10"); malformed strings such as "2.5-beta" or "2.5garbage"
// fail closed (force age check) rather than silently matching the "2.5" prefix.
export function isAtLeastVersion(version: string | null | undefined, minimum: string): boolean {
  const parse = (v: string) => {
    const match = /^(\d+)\.(\d+)$/.exec(v)
    return match ? [Number(match[1]), Number(match[2])] : null
  }
  const actual = version ? parse(version) : null
  const required = parse(minimum)
  if (!actual || !required) return false
  return actual[0] !== required[0] ? actual[0] > required[0] : actual[1] >= required[1]
}

/**
 * Re-acceptance skip rule, shared by acceptance and cancellation: there is no dedicated
 * age-verification record, so the age check is skipped ONLY when this is a re-acceptance
 * (termsMachine `isUpdate`) AND the previously accepted version (subscription.termsVersion)
 * is >= FIRST_AGE_GATED_TERMS_VERSION, i.e. it was accepted through the age gate. Legacy
 * accounts (accepted before the gate existed) and new accounts must complete the age flow.
 */
export function termsAgeAlreadyVerified(
  isUpdate: boolean,
  previousTermsVersion: string | null | undefined,
): boolean {
  return isUpdate && isAtLeastVersion(previousTermsVersion, FIRST_AGE_GATED_TERMS_VERSION)
}

/**
 * One cancel policy for both decline surfaces: a first-time decline has no previously
 * accepted Terms to keep using, so declining means leaving — the button is labeled
 * "Sign Out". An update cancellation follows the SAME age-gate rule as acceptance
 * (CodeRabbit round on PR #812): an eligible account declines straight into
 * notice-then-enforce, while a legacy account (accepted before the gate) must run the
 * age flow first — declining directly would keep access without ever reaching the
 * age-rejection path.
 */
export function handleTermsCanceled(
  termsService: TermsMachineActor,
  authService: AuthMachineActor,
  verifyAge: () => void,
): void {
  const context = termsService.getSnapshot().context
  if (!context.isUpdate) {
    authService.send({ type: 'SIGN_OUT' })
    return
  }
  if (termsAgeAlreadyVerified(context.isUpdate, context.subscription?.termsVersion)) {
    handleTermsDecline(termsService)
    return
  }
  verifyAge()
}
