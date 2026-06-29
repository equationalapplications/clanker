import type { WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import admin from 'firebase-admin'
import { z } from 'zod'
import type { FirestoreSession } from '../services/firestoreSession.js'
import type { FcmDispatcher } from '../services/fcmDispatcher.js'
import { sessionBridge } from '../services/sessionBridge.js'
import type { TaskResult, TaskIntent } from '../../../shared/dsl-types.js'
import { taskErrorFrameSchema } from '../../../shared/dsl-schema.js'
import { startAuthApprovalObserver } from './authApprovalObserver.js'

const browserAuthSchema = z.object({
  type: z.literal('auth'),
  idToken: z.string().min(1),
  sessionId: z.string().uuid(),
  deviceId: z.string().min(1),
})

const resultFrameSchema = z.object({
  type: z.literal('task_result'),
  taskId: z.string(),
  data: z.record(z.string(), z.string()),
  activeUrl: z.string(),
})

const awaitingAuthFrameSchema = z.object({
  type: z.literal('awaiting_auth'),
  taskId: z.string(),
  haltedStepIndex: z.number().int().nonnegative(),
  partialData: z.record(z.string(), z.string()).optional(),
  partialActiveUrl: z.string().optional(),
})

export interface BrowserWsOptions {
  firestoreSession: FirestoreSession
  fcmDispatcher?: FcmDispatcher
  verifyToken?: (token: string) => Promise<{ uid: string }>
  resolveUserId?: (firebaseUid: string) => Promise<string | null>
  validateDevice?: (firebaseUid: string, deviceId: string) => Promise<boolean>
  getDeviceFcmToken?: (uid: string, deviceId: string) => Promise<string | null>
  getExpoPushToken?: (uid: string) => Promise<string | null>
  instanceId: string
  authTimeoutMs?: number
  /** Override for tests — default 5 min. */
  authApprovalTtlMs?: number
}

export function handleBrowserWsUpgrade(
  ws: WebSocket,
  _req: IncomingMessage,
  options: BrowserWsOptions,
): void {
  const verifyToken = options.verifyToken ??
    ((t: string) => admin.auth().verifyIdToken(t).then((d) => ({ uid: d.uid })))
  const resolveUserId = options.resolveUserId ?? (async (u: string) => u)
  const validateDevice = options.validateDevice ?? (async () => true)
  const fs = options.firestoreSession
  const fwd = options.fcmDispatcher
  const authTimeoutMs = options.authTimeoutMs ?? 5000

  let authed = false
  let firebaseUid: string | null = null
  let sessionId: string | null = null
  let deviceId: string | null = null
  let dispatchedIntent: TaskIntent | null = null
  let isResume = false

  const authTimer = setTimeout(() => {
    if (!authed && ws.readyState === ws.OPEN) ws.close(4001, 'Auth timeout')
  }, authTimeoutMs)

  function sendSessionEndIfOpen(): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'session_end' }))
  }

  async function onAuth(raw: unknown): Promise<void> {
    const parsed = browserAuthSchema.safeParse(raw)
    if (!parsed.success) { ws.close(4001, 'Invalid auth frame'); return }
    const { idToken, sessionId: sid, deviceId: did } = parsed.data
    let fbUid: string
    try { fbUid = (await verifyToken(idToken)).uid } catch { ws.close(4001, 'Token verification failed'); return }
    const resolved = await resolveUserId(fbUid)
    if (!resolved) { ws.close(4001, 'User not found'); return }
    if (!(await validateDevice(resolved, did))) { ws.close(4001, 'Unknown device'); return }

    const session = await fs.getSession(resolved, sid)
    if (session.status === 'closed' || session.status === 'aborted') {
      ws.close(4001, 'Session closed')
      return
    }

    firebaseUid = resolved; sessionId = sid; deviceId = did; authed = true
    clearTimeout(authTimer)

    const pendingTask = await fs.getFirstTask(firebaseUid, sid)
    if (!pendingTask) { ws.close(4001, 'No pending task'); return }

    dispatchedIntent = pendingTask.intent

    let resumeIntent = pendingTask.intent
    if (pendingTask.status === 'awaiting_auth') {
      isResume = true
      const orig = pendingTask.intent.action
      if (orig.type === 'sequence' && pendingTask.haltedStepIndex != null) {
        resumeIntent = {
          ...pendingTask.intent,
          requiresAuth: false,
          action: { type: 'sequence', steps: orig.steps.slice(pendingTask.haltedStepIndex) },
        }
      } else {
        resumeIntent = { ...pendingTask.intent, requiresAuth: false }
      }
    }

    await fs.markBrowserConnected(firebaseUid, sid, options.instanceId, pendingTask.intent.taskId)
    sessionBridge.registerBrowser(firebaseUid, sid, ws)
    ws.send(JSON.stringify({ type: 'session_ready', sessionId: sid }))
    ws.send(JSON.stringify({ type: 'task', intent: resumeIntent }))
  }

  async function onResult(raw: unknown): Promise<void> {
    if (!authed || !firebaseUid || !sessionId) return
    const r = resultFrameSchema.safeParse(raw)
    if (r.success) {
      let data = r.data.data
      let activeUrl = r.data.activeUrl
      if (isResume) {
        const task = await fs.getTask(firebaseUid, sessionId, r.data.taskId)
        data = { ...(task.partialData ?? {}), ...data }
        activeUrl = activeUrl || task.partialActiveUrl || ''
      }
      const result: TaskResult = { taskId: r.data.taskId, status: 'complete', data, activeUrl }
      await fs.writeTaskResult(firebaseUid, sessionId, r.data.taskId, result)
      if (isResume && fwd && options.getExpoPushToken) {
        const expoPushToken = await options.getExpoPushToken(firebaseUid)
        if (expoPushToken) {
          await fwd.sendTaskComplete(expoPushToken, sessionId, r.data.taskId, 'Your browser task finished.').catch(
            (err) => console.error('sendTaskComplete failed:', err),
          )
        }
      }
      ws.send(JSON.stringify({ type: 'session_end' }))
      return
    }
    const e = taskErrorFrameSchema.safeParse(raw)
    if (e.success) {
      const result: TaskResult = {
        taskId: e.data.taskId, status: 'failed', data: {}, activeUrl: '',
        error: { code: e.data.code, message: e.data.message, failedAction: e.data.failedAction },
      }
      await fs.writeTaskResult(firebaseUid, sessionId, e.data.taskId, result)
      ws.send(JSON.stringify({ type: 'session_end' }))
    }
  }

  async function onAwaitingAuth(raw: unknown): Promise<void> {
    if (!authed || !firebaseUid || !sessionId || !dispatchedIntent) return
    const parsed = awaitingAuthFrameSchema.safeParse(raw)
    if (!parsed.success) return
    const { taskId, haltedStepIndex, partialData, partialActiveUrl } = parsed.data

    if (taskId !== dispatchedIntent.taskId) { ws.close(4001, 'Task mismatch'); return }
    if (dispatchedIntent.action.type === 'sequence') {
      if (haltedStepIndex >= dispatchedIntent.action.steps.length) { ws.close(4001, 'Invalid haltedStepIndex'); return }
    } else if (haltedStepIndex !== 0) {
      ws.close(4001, 'Invalid haltedStepIndex'); return
    }

    const actionSummary = dispatchedIntent.actionSummary

    await fs.haltForAuth(firebaseUid, sessionId, taskId, haltedStepIndex, actionSummary, partialData, partialActiveUrl)

    if (fwd && options.getExpoPushToken) {
      const expoPushToken = await options.getExpoPushToken(firebaseUid)
      if (expoPushToken) {
        await fwd.sendApprovalCard(expoPushToken, sessionId, taskId, actionSummary).catch(
          (err) => console.error('sendApprovalCard failed:', err),
        )
      }
    }

    const deviceFcmToken = options.getDeviceFcmToken
      ? await options.getDeviceFcmToken(firebaseUid, deviceId!)
      : null

    if (!deviceFcmToken) {
      await fs.writeTaskResult(firebaseUid, sessionId, taskId, {
        taskId, status: 'aborted', data: {}, activeUrl: '',
        error: { code: 'EXECUTION_ERROR', message: 'No device FCM token — cannot resume after approval.', failedAction: dispatchedIntent.action as never },
      })
      sendSessionEndIfOpen()
      return
    }

    // Observer lifetime is independent of this WebSocket — extension closes WS on halt.
    startAuthApprovalObserver({
      fs,
      fcmDispatcher: fwd,
      verifyToken,
      getExpoPushToken: options.getExpoPushToken,
      firebaseUid,
      sessionId,
      taskId,
      intent: dispatchedIntent,
      deviceFcmToken,
      authApprovalTtlMs: options.authApprovalTtlMs,
      onResolved: sendSessionEndIfOpen,
    })
  }

  ws.on('message', (data: Buffer) => {
    let parsed: unknown
    try { parsed = JSON.parse(data.toString()) } catch { return }
    const type = (parsed as { type?: string }).type
    if (type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return }
    if (!authed) {
      void onAuth(parsed).catch(() => ws.close(1011, 'Internal error'))
      return
    }
    if (type === 'task_result' || type === 'task_error') {
      void onResult(parsed).catch(() => ws.close(1011, 'Internal error'))
      return
    }
    if (type === 'awaiting_auth') {
      void onAwaitingAuth(parsed).catch(() => ws.close(1011, 'Internal error'))
      return
    }
  })

  ws.on('close', () => {
    clearTimeout(authTimer)
    if (firebaseUid && sessionId) sessionBridge.deregisterBrowser(firebaseUid, sessionId)
  })
  ws.on('error', () => { clearTimeout(authTimer) })
}
