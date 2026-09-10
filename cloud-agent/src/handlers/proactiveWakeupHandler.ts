import { z } from 'zod'
import type { Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { AGENT_TURN_CREDIT_COST } from '../constants/credits.js'
import { defaultFcmDispatcher } from '../services/fcmDispatcher.js'
import type { CreditService, CreditSpendAllocation } from '../services/creditService.js'
import type { FcmDispatcher } from '../services/fcmDispatcher.js'

export type DeliveryMode = 'notify' | 'quiet' | 'silent'

const bodySchema = z.object({
  wakeupId: z.string().min(1),
  characterId: z.string().uuid(),
  uid: z.string().min(1),
  runKey: z.string().min(1),
  reason: z.string().min(1),
  notifyAllowed: z.boolean(),
})

export interface ProactiveCharacter {
  id: string
  name: string
  expoPushToken?: string | null
  appearance: string | null
  traits: string | null
  emotions: string | null
  context: string | null
  // Decision 1: per-device readiness flag. Bounds the eventual un-gate to
  // clients that can sync/badge/deeplink; mirrors `users.proactive_push_ready`.
  // The handler reads this on the notify branch alongside expoPushToken and
  // messageId — the flag-true user is the only one that ever sees a push.
  proactivePushReady: boolean
}

/**
 * The row identity `claimRunKey` actually locked. `run_key` carries a UNIQUE
 * index, so at most one row can ever match — but the caller supplies `wakeupId`
 * and `runKey` as independent fields, so the row we locked is not necessarily
 * the row the caller named. Returning the id lets the handler prove they agree
 * before any credit is committed.
 */
export interface RunKeyClaim {
  status: 'reserved' | 'duplicate'
  id: string | null
}

export interface ProactiveWakeupDeps {
  resolveUserId: (firebaseUid: string) => Promise<string | null>
  loadCharacter: (characterId: string, userId: string) => Promise<ProactiveCharacter | null>
  runAgent: (args: {
    userId: string
    firebaseUid: string
    characterId: string
    character: ProactiveCharacter
    reason: string
  }) => Promise<{ reply: string; toolCalls: string[]; deliveryMode: DeliveryMode }>
  creditService: Pick<CreditService, 'spendCredit' | 'refundCredit'>
  resolveWakeup: (
    wakeupId: string,
    patch: {
      status: string
      spentAmount: number
      outcome: string
      deliveryMode?: string
      chosenDeliveryMode?: string
    },
  ) => Promise<void>
  claimRunKey: (runKey: string) => Promise<RunKeyClaim>
  insertProactiveMessage: (input: {
    messageId: string
    characterId: string
    senderUserId: string
    text: string
    createdAt: Date
  }) => Promise<void>
  fcmDispatcher?: Pick<FcmDispatcher, 'sendCharacterProactive'>
  // Injectable so the flag-gate tests can stub it to pass notify through while
  // the real exported `resolveDeliveryMode` keeps PROACTIVE_PUSH_ENABLED =
  // false (the global gate stays closed in this branch). Defaults to the real
  // export when the host wires up the handler.
  resolveDeliveryMode?: (
    chosen: DeliveryMode,
    notifyAllowed: boolean,
    pushReady: boolean,
  ) => DeliveryModeResolution
}

/**
 * TEMPORARY — remove with the lifecycle-sync fast-follow.
 *
 * A push deeplinks to `/chat/{characterId}`, and that screen reads local
 * SQLite. Nothing currently pulls proactive messages onto the device:
 * `syncProactiveMessages` has no callers, and there is no general message
 * down-sync to land them incidentally. So a notify today produces a
 * notification the user can tap into an empty thread — worse than sending
 * nothing. The unread badge was severed from the UI for exactly this reason;
 * push depends on the same dead path and is gated for the same reason.
 *
 * Un-gate in the same change that wires the sync triggers, not before.
 */
const PROACTIVE_PUSH_ENABLED = false

/**
 * The model proposes, the code disposes. The agent picks a delivery mode via the
 * deliver_wakeup tool; the sweeper's cap and cooldown decide whether notifying
 * is permissible at all, and a forbidden notify degrades to quiet rather than
 * being dropped.
 *
 * The gate is applied here rather than at the push call site so the row stays
 * self-consistent: `delivery_mode` records quiet, which keeps `todaysPushCount`
 * from counting a push that never went out and suppressing later real ones. The
 * agent's intent is not lost — `chosen_delivery_mode` still records notify, so
 * the "how often would a character have interrupted" telemetry is unaffected.
 *
 * The clamp REASON is recorded because the two clamps mean opposite things to
 * the Phase 2 rollout gate: a guardrail clamp (cooldown/cap/unread said no) is
 * the signal PROACTIVE_NOTIFY_COOLDOWN_MS and MAX_PROACTIVE_PUSHES_PER_DAY are
 * tuned against, while a gate clamp means the guardrails WOULD have permitted
 * the push and only the closed PROACTIVE_PUSH_ENABLED gate stopped it. Without
 * the reason the columns cannot tell them apart, and during the shadow phase
 * every chosen=notify is clamped — leaving clamped_pct permanently ambiguous.
 * The guardrail is checked FIRST so the tunable signal survives the shadow
 * phase: while the gate is closed, a notify the guardrails would have blocked
 * is labelled 'guardrail', and only guardrail-permitted notifies are labelled
 * 'gate'. The reason rides in the outcome string (`clamp=guardrail`/
 * `clamp=gate`); the 0028 backfill only parses rows with NULL columns, which
 * post-0028 writers never produce, so the suffix cannot confuse it.
 */
export interface DeliveryModeResolution {
  mode: DeliveryMode
  clampReason: 'guardrail' | 'gate' | 'flag' | null
}

/**
 * `pushReady` is the per-user `proactivePushReady` capability flag. It is
 * resolved HERE rather than at the push call site for the same reason the gate
 * is: a notify suppressed at the call site would still persist
 * `delivery_mode = 'notify'`, and that column is what
 * proactiveWakeupSweep.loadContext counts into `todaysPushCount` — so a user
 * whose pushes are all flag-suppressed would burn the daily cap on pushes that
 * never went out and suppress the real ones that follow.
 *
 * Ordering is deliberate and matches the clamp-reason contract above: guardrail
 * first (the tunable signal), then the gate, then the flag. While
 * PROACTIVE_PUSH_ENABLED is false the flag branch is unreachable, so this adds
 * no new clamp reason to the shadow-phase telemetry; 'flag' only starts
 * appearing once the un-gate lands, which is exactly when it becomes the
 * distinct thing operators need to see.
 */
export function resolveDeliveryMode(
  chosen: DeliveryMode,
  notifyAllowed: boolean,
  pushReady = true,
): DeliveryModeResolution {
  if (chosen !== 'notify') return { mode: chosen, clampReason: null }
  if (!notifyAllowed) return { mode: 'quiet', clampReason: 'guardrail' }
  if (!PROACTIVE_PUSH_ENABLED) return { mode: 'quiet', clampReason: 'gate' }
  if (!pushReady) return { mode: 'quiet', clampReason: 'flag' }
  return { mode: 'notify', clampReason: null }
}

export function createProactiveWakeupHandler(deps: ProactiveWakeupDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body' })
      return
    }
    const { wakeupId, characterId, uid, runKey, reason, notifyAllowed } = parsed.data

    let userId: string
    try {
      const resolved = await deps.resolveUserId(uid)
      if (!resolved) {
        res.status(422).json({ error: 'User not found' })
        return
      }
      userId = resolved
    } catch (err) {
      console.error('[proactive-wakeup] resolveUserId error:', err)
      res.status(500).json({ error: 'Internal server error' })
      return
    }

    // Idempotency: a retried sweep must not spend twice.
    let claim: RunKeyClaim
    try {
      claim = await deps.claimRunKey(runKey)
    } catch (err) {
      console.error('[proactive-wakeup] claimRunKey error:', err)
      res.status(500).json({ error: 'Internal server error' })
      return
    }
    if (claim.status === 'duplicate') {
      res.json({ ok: true, mode: 'silent', spentAmount: 0, duplicate: true })
      return
    }

    // wakeupId and runKey arrive as independent body fields, so a malformed or
    // mis-assembled caller can name row A while runKey locks row B. Every
    // terminal path below resolves by wakeupId, so without this check we would
    // run and bill a turn against A's payload while B stays locked forever.
    // Release the row we actually claimed — resolving by claim.id, not
    // wakeupId — so the mismatch costs one skipped wake-up, not a leaked row.
    if (claim.id !== wakeupId) {
      console.error('[proactive-wakeup] identifier mismatch: runKey claimed a different row', {
        wakeupId,
        claimedId: claim.id,
      })
      if (claim.id) {
        await deps
          .resolveWakeup(claim.id, {
            status: 'skipped',
            spentAmount: 0,
            outcome: 'identifier_mismatch',
          })
          .catch(() => {})
      }
      res.status(400).json({ error: 'wakeupId does not match runKey' })
      return
    }

    let allocations: CreditSpendAllocation[]
    try {
      allocations = await deps.creditService.spendCredit(
        userId,
        AGENT_TURN_CREDIT_COST,
        'proactive_wakeup',
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg === 'INSUFFICIENT_CREDITS') {
        await deps
          .resolveWakeup(wakeupId, {
            status: 'skipped',
            spentAmount: 0,
            outcome: 'insufficient_power',
          })
          .catch(() => {})
        res.status(402).json({ error: 'Insufficient credits' })
        return
      }
      // Non-INSUFFICIENT_CREDITS failure (DB blip, network, etc.): the row is
      // currently in 'claimed' status because claimRunKey ran first. Without an
      // explicit resolve the row stays 'claimed' and the sweeper, which only
      // selects 'pending', would never retry it. Mark 'skipped' (not 'pending')
      // to avoid retry-loop storms from a persistent failure mode. spentAmount=0
      // because we can't tell whether spendCredit committed before the throw;
      // worst case is one wake-up goes unmetered — within the documented
      // one-turn overshoot bound.
      await deps
        .resolveWakeup(wakeupId, {
          status: 'skipped',
          spentAmount: 0,
          outcome: 'spend_failed',
        })
        .catch(() => {})
      console.error('[proactive-wakeup] spendCredit error:', err)
      res.status(500).json({ error: 'Internal server error' })
      return
    }

    const spentAmount = allocations.reduce((sum, a) => sum + a.amount, 0)

    // refundCredit is not idempotent — each call increases remaining_balance or
    // inserts another refund_compensation row — so the spend must be refunded
    // at most once no matter which path unwinds. Guarding with a flag rather
    // than a local try/catch makes that structural: every statement after an
    // early-branch refund (resolveWakeup, the response write) still sits inside
    // the outer try, so a throw there lands in the outer catch, which refunds
    // again. A client that disconnects before Express flushes the 422 is enough
    // to trigger it. The flag is set before the await so an in-flight refund
    // that throws is still counted as attempted and never retried.
    let refunded = false
    const refundOnce = async (context: string) => {
      if (refunded) return
      refunded = true
      try {
        await deps.creditService.refundCredit(userId, allocations)
      } catch (refundErr) {
        console.warn(`[proactive-wakeup] refundCredit failed (${context}):`, refundErr)
      }
    }

    try {
      const character = await deps.loadCharacter(characterId, userId)
      if (!character) {
        await refundOnce('character_missing')
        await deps
          .resolveWakeup(wakeupId, {
            status: 'skipped',
            spentAmount: 0,
            outcome: 'character_missing',
          })
          .catch(() => {})
        res.status(422).json({ error: 'Character not found' })
        return
      }

      // Hand the row we just validated straight to runAgent. It carries every
      // field assembleSystemInstruction needs, so re-selecting it there would
      // be a second identical SELECT per wake-up for no added safety.
      const result = await deps.runAgent({
        userId,
        firebaseUid: uid,
        characterId,
        character,
        reason,
      })
      const { mode, clampReason } = (deps.resolveDeliveryMode ?? resolveDeliveryMode)(
        result.deliveryMode,
        notifyAllowed,
        character.proactivePushReady,
      )

      // 'silent' means the character decided there was nothing worth saying.
      // Persisting an empty row would badge the user for nothing.
      let messageId: string | undefined
      if (mode !== 'silent' && result.reply.trim().length > 0) {
        messageId = randomUUID()
        await deps.insertProactiveMessage({
          messageId,
          characterId,
          senderUserId: userId,
          text: result.reply,
          createdAt: new Date(),
        })
      }

      // No proactivePushReady check here: resolveDeliveryMode already clamped a
      // flag-false notify to quiet, so reaching 'notify' means the flag is set.
      // Re-checking it at this call site is what let a suppressed push persist
      // delivery_mode='notify' and inflate todaysPushCount.
      if (mode === 'notify' && character.expoPushToken && messageId) {
        // Never let a push failure fail the wake-up: the message is already
        // persisted and will arrive on next sync regardless.
        await (deps.fcmDispatcher ?? defaultFcmDispatcher())
          .sendCharacterProactive(
            character.expoPushToken,
            characterId,
            messageId,
            character.name,
            result.reply,
          )
          .catch((err: unknown) => {
            console.warn('[proactive-wakeup] push failed:', err)
          })
      }
      // point: it yields production data on how often characters WOULD have
      // interrupted, before any user can be interrupted.
      await deps.resolveWakeup(wakeupId, {
        status: 'done',
        spentAmount,
        // outcome is kept as-is: it is the human-readable audit trail and the
        // source the 0028 backfill parses. The columns are what code reads.
        // The clamp reason suffix is the one deliberate exception: it is the
        // only place the gate/guardrail split exists, and the telemetry
        // script's clamp-reason query parses exactly this field.
        outcome: `mode=${mode} chosen=${result.deliveryMode}${
          clampReason ? ` clamp=${clampReason}` : ''
        }`,
        deliveryMode: mode,
        chosenDeliveryMode: result.deliveryMode,
      })

      res.json({ ok: true, mode, spentAmount })
    } catch (err) {
      console.error('[proactive-wakeup] turn failed:', err)
      await refundOnce('turn_failed')
      // spentAmount 0: a refunded turn must not consume the day's allowance.
      await deps
        .resolveWakeup(wakeupId, { status: 'skipped', spentAmount: 0, outcome: 'turn_failed' })
        .catch(() => {})
      res.status(500).json({ error: 'Internal server error' })
    }
  }
}
