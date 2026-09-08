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
      const mode = resolveDeliveryMode(result.deliveryMode, notifyAllowed)

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
        outcome: `mode=${mode} chosen=${result.deliveryMode}`,
        deliveryMode: mode,
        chosenDeliveryMode: result.deliveryMode,
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
