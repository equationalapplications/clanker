import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { NextFunction, Request, Response } from 'express'
import type { FirestoreSession } from '../services/firestoreSession.js'
import type { FcmDispatcher } from '../services/fcmDispatcher.js'
import type { CreditService } from '../services/creditService.js'
import type { TaskDoc } from '../../../shared/dsl-types.js'
import { singleActionSchema } from '../../../shared/dsl-schema.js'
import { intentRequiresAuth } from '../../../shared/constants.js'
import { findBlockedNavigation } from '../../../shared/hostPolicy.js'
import { INSTANCE_ID } from '../services/instanceId.js'

export interface SchedulerTriggerOptions {
  schedulerTimeoutMs?: number
}

const schedulerActionSchema = z.union([
  singleActionSchema,
  z.object({
    type: z.literal('sequence'),
    steps: z.array(singleActionSchema).min(1),
  }),
])

const schedulerBodySchema = z.object({
  uid: z.string().min(1),
  runKey: z.string().min(1),
  action: schedulerActionSchema,
  actionSummary: z.string().min(1),
  notificationBody: z.string().min(1),
})

function constantTimeEquals(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided)
  const expectedBuffer = Buffer.from(expected)
  if (providedBuffer.length !== expectedBuffer.length) return false
  try {
    return timingSafeEqual(providedBuffer, expectedBuffer)
  } catch {
    return false
  }
}

export function isSchedulerAuthorized(req: Request, secret: string): boolean {
  const authHeader = req.headers.authorization ?? ''
  const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : ''
  return Boolean(token && constantTimeEquals(token, secret))
}

/** Bearer SCHEDULER_SECRET check — mount after a rate limiter in production routes. */
export function createRequireSchedulerSecret(secret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isSchedulerAuthorized(req, secret)) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    next()
  }
}

function scheduledActionNeedsApproval(
  actionSummary: string,
  action: z.infer<typeof schedulerActionSchema>,
): boolean {
  return intentRequiresAuth(actionSummary, action)
}

function waitForTerminalTask(
  fs: FirestoreSession,
  uid: string,
  sessionId: string,
  taskId: string,
  timeoutMs: number,
): Promise<TaskDoc> {
  return new Promise((resolve, reject) => {
    let unsub: () => void = () => {}
    const timeout = setTimeout(() => {
      unsub()
      reject(new Error('TIMEOUT'))
    }, timeoutMs)

    unsub = fs.watchTask(uid, sessionId, taskId, (task) => {
      if (task.status === 'complete' || task.status === 'failed' || task.status === 'aborted') {
        clearTimeout(timeout)
        unsub()
        resolve(task)
      }
    })
  })
}

export function createSchedulerTriggerHandler(
  fs: FirestoreSession,
  fcm: Pick<FcmDispatcher, 'wakeExtension' | 'sendProactive'>,
  getExpoPushToken: (firebaseUid: string) => Promise<string | null>,
  creditService: Pick<CreditService, 'spendCredit' | 'refundCredit'>,
  resolveUserId: (firebaseUid: string) => Promise<string | null>,
  opts: SchedulerTriggerOptions,
) {
  const timeoutMs = opts.schedulerTimeoutMs ?? 60_000

  return async (req: Request, res: Response): Promise<void> => {
    const parsed = schedulerBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body' })
      return
    }

    const { uid, runKey, action, actionSummary, notificationBody } = parsed.data

    const blocked = findBlockedNavigation(action)
    if (blocked) {
      res.status(422).json({ error: `HOST_NOT_ALLOWED: ${blocked.message}` })
      return
    }

    if (scheduledActionNeedsApproval(actionSummary, action)) {
      res.status(422).json({
        error: 'REQUIRES_AUTH: Scheduled tasks cannot include actions that require approval',
      })
      return
    }

    let device: { deviceId: string; fcmToken: string; deviceName: string } | null
    try {
      device = await fs.getActiveDevice(uid)
    } catch (err) {
      console.error('[scheduler-trigger] getActiveDevice error:', err)
      res.status(500).json({ error: 'Internal server error' })
      return
    }

    if (!device) {
      res.status(422).json({ error: 'No active device for this user' })
      return
    }

    let userId: string
    try {
      const resolved = await resolveUserId(uid)
      if (!resolved) {
        res.status(422).json({ error: 'User not found' })
        return
      }
      userId = resolved
    } catch (err) {
      console.error('[scheduler-trigger] resolveUserId error:', err)
      res.status(500).json({ error: 'Internal server error' })
      return
    }

    const sessionId = crypto.randomUUID()
    const taskId = crypto.randomUUID()

    let isDuplicateRun = false
    try {
      const reservation = await fs.reserveSchedulerRun(uid, runKey, { sessionId, taskId })
      isDuplicateRun = reservation === 'duplicate'
    } catch (err) {
      console.error('[scheduler-trigger] reserveSchedulerRun error:', err)
      res.status(500).json({ error: 'Internal server error' })
      return
    }

    let activeSessionId: string = sessionId
    let activeTaskId: string = taskId

    if (isDuplicateRun) {
      try {
        const existing = await fs.getSchedulerRun(uid, runKey)
        if (!existing) {
          res.status(500).json({ error: 'Internal server error' })
          return
        }
        activeSessionId = existing.sessionId
        activeTaskId = existing.taskId
      } catch (err) {
        console.error('[scheduler-trigger] getSchedulerRun error:', err)
        res.status(500).json({ error: 'Internal server error' })
        return
      }
    }

    let txId: string | null = null
    if (!isDuplicateRun) {
      try {
        txId = await creditService.spendCredit(userId)
      } catch (err) {
        const msg = err instanceof Error ? err.message : ''
        if (msg === 'INSUFFICIENT_CREDITS') {
          res.status(402).json({ error: 'Insufficient credits' })
          return
        }
        console.error('[scheduler-trigger] spendCredit error:', err)
        res.status(500).json({ error: 'Internal server error' })
        return
      }
    }

    const taskIntent = {
      version: '1' as const,
      taskId: activeTaskId,
      sessionId: activeSessionId,
      requiresAuth: intentRequiresAuth(actionSummary, action),
      actionSummary,
      action,
    }

    if (!isDuplicateRun) {
      try {
        await fs.createSession(uid, activeSessionId, { status: 'pending', trigger: 'scheduler', voiceInstanceId: INSTANCE_ID })
        await fs.writeTask(uid, activeSessionId, activeTaskId, taskIntent)
      } catch (err) {
        console.error('[scheduler-trigger] setup error:', err)
        if (txId) {
          try { await creditService.refundCredit(userId, txId) } catch { /* logged */ }
        }
        try { await fs.closeSession(uid, activeSessionId, 'aborted') } catch { /* ignore */ }
        res.status(500).json({ error: 'Internal server error' })
        return
      }

      // FCM wake is best-effort — extension falls back to alarm-based polling.
      if (!device.fcmToken.startsWith('polling:')) {
        try {
          await fcm.wakeExtension(device.fcmToken, activeSessionId, activeTaskId)
        } catch (err) {
          console.warn('[scheduler-trigger] FCM wake failed, extension will poll:', err instanceof Error ? err.message : err)
        }
      }
    }

    let task: TaskDoc | null = null
    try {
      task = await waitForTerminalTask(fs, uid, activeSessionId, activeTaskId, timeoutMs)
    } catch {
      let abortedOffline = false
      try {
        abortedOffline = await fs.abortPendingTaskIfOffline(uid, activeSessionId, activeTaskId, {
          taskId: activeTaskId, status: 'failed', data: {}, activeUrl: '',
          error: {
            code: 'EXTENSION_OFFLINE',
            message: 'Browser extension did not connect',
            failedAction: action as never,
          },
        })
      } catch { /* ignore */ }

      if (!abortedOffline) {
        try {
          await fs.writeTaskResult(uid, activeSessionId, activeTaskId, {
            taskId: activeTaskId, status: 'failed', data: {}, activeUrl: '',
            error: {
              code: 'EXECUTION_TIMEOUT',
              message: 'Scheduler task timed out',
              failedAction: action as never,
            },
          })
        } catch { /* ignore */ }
      }

      if (!isDuplicateRun && abortedOffline && txId) {
        try { await creditService.refundCredit(userId, txId) } catch { /* logged */ }
      }

      try { await fs.closeSession(uid, activeSessionId, 'aborted') } catch { /* ignore */ }
      res.status(504).json({ error: 'Task timed out', sessionId: activeSessionId, taskId: activeTaskId })
      return
    }

    try { await fs.closeSession(uid, activeSessionId, 'closed') } catch { /* ignore */ }

    const pushBody = task.status === 'complete'
      ? notificationBody
      : `Browser task failed (${task.error?.code ?? 'unknown'}). Tap to check.`

    if (!isDuplicateRun) {
      try {
        const expoPushToken = await getExpoPushToken(uid)
        if (expoPushToken) {
          await fcm.sendProactive(expoPushToken, activeSessionId, activeTaskId, pushBody)
        }
      } catch (err) {
        console.error('[scheduler-trigger] sendProactive error:', err)
      }
    }

    res.json({ ok: true, sessionId: activeSessionId, taskId: activeTaskId, status: task.status })
  }
}
