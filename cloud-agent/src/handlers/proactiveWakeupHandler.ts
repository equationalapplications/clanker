import { z } from 'zod'
import type { Request, Response } from 'express'
import { AGENT_TURN_CREDIT_COST } from '../constants/credits.js'
import type { CreditService, CreditSpendAllocation } from '../services/creditService.js'

export type DeliveryMode = 'notify' | 'quiet' | 'silent'

const bodySchema = z.object({
  wakeupId: z.string().min(1),
  characterId: z.string().uuid(),
  uid: z.string().min(1),
  runKey: z.string().min(1),
  reason: z.string().min(1),
  notifyAllowed: z.boolean(),
})

export interface ProactiveWakeupDeps {
  resolveUserId: (firebaseUid: string) => Promise<string | null>
  loadCharacter: (
    characterId: string,
    userId: string,
  ) => Promise<{
    id: string
    name: string
    appearance: string | null
    traits: string | null
    emotions: string | null
    context: string | null
  } | null>
  runAgent: (args: {
    userId: string
    firebaseUid: string
    characterId: string
    reason: string
  }) => Promise<{ reply: string; toolCalls: string[]; deliveryMode: DeliveryMode }>
  creditService: Pick<CreditService, 'spendCredit' | 'refundCredit'>
  resolveWakeup: (
    wakeupId: string,
    patch: { status: string; spentAmount: number; outcome: string },
  ) => Promise<void>
  claimRunKey: (runKey: string) => Promise<'reserved' | 'duplicate'>
}

/**
 * The model proposes, the code disposes. The agent picks a delivery mode via the
 * deliver_wakeup tool; the sweeper's cap and cooldown decide whether notifying
 * is permissible at all, and a forbidden notify degrades to quiet rather than
 * being dropped.
 */
export function resolveDeliveryMode(chosen: DeliveryMode, notifyAllowed: boolean): DeliveryMode {
  if (chosen === 'notify' && !notifyAllowed) return 'quiet'
  return chosen
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
    let reservation: 'reserved' | 'duplicate'
    try {
      reservation = await deps.claimRunKey(runKey)
    } catch (err) {
      console.error('[proactive-wakeup] claimRunKey error:', err)
      res.status(500).json({ error: 'Internal server error' })
      return
    }
    if (reservation === 'duplicate') {
      res.json({ ok: true, mode: 'silent', spentAmount: 0, duplicate: true })
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

    try {
      const character = await deps.loadCharacter(characterId, userId)
      if (!character) {
        await deps.creditService.refundCredit(userId, allocations)
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

      const result = await deps.runAgent({ userId, firebaseUid: uid, characterId, reason })
      const mode = resolveDeliveryMode(result.deliveryMode, notifyAllowed)

      // Phase 1 delivers nothing. Recording the mode the model chose is the
      // point: it yields production data on how often characters WOULD have
      // interrupted, before any user can be interrupted.
      await deps.resolveWakeup(wakeupId, {
        status: 'done',
        spentAmount,
        outcome: `mode=${mode} chosen=${result.deliveryMode}`,
      })

      res.json({ ok: true, mode, spentAmount })
    } catch (err) {
      console.error('[proactive-wakeup] turn failed:', err)
      try {
        await deps.creditService.refundCredit(userId, allocations)
      } catch (refundErr) {
        console.warn('[proactive-wakeup] refundCredit failed:', refundErr)
      }
      // spentAmount 0: a refunded turn must not consume the day's allowance.
      await deps
        .resolveWakeup(wakeupId, { status: 'skipped', spentAmount: 0, outcome: 'turn_failed' })
        .catch(() => {})
      res.status(500).json({ error: 'Internal server error' })
    }
  }
}
