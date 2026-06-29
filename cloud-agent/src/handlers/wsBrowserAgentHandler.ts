import type { WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import admin from 'firebase-admin'
import { z } from 'zod'
import type { FirestoreSession } from '../services/firestoreSession.js'
import { sessionBridge } from '../services/sessionBridge.js'
import type { TaskResult } from '../../../shared/dsl-types.js'
import { taskErrorFrameSchema } from '../../../shared/dsl-schema.js'

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


export interface BrowserWsOptions {
  firestoreSession: FirestoreSession
  verifyToken?: (token: string) => Promise<{ uid: string }>
  resolveUserId?: (firebaseUid: string) => Promise<string | null>
  validateDevice?: (firebaseUid: string, deviceId: string) => Promise<boolean>
  instanceId: string
  authTimeoutMs?: number
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
  const authTimeoutMs = options.authTimeoutMs ?? 5000

  let authed = false
  let firebaseUid: string | null = null
  let sessionId: string | null = null

  const authTimer = setTimeout(() => {
    if (!authed && ws.readyState === ws.OPEN) ws.close(4001, 'Auth timeout')
  }, authTimeoutMs)

  async function onAuth(raw: unknown): Promise<void> {
    const parsed = browserAuthSchema.safeParse(raw)
    if (!parsed.success) { ws.close(4001, 'Invalid auth frame'); return }
    const { idToken, sessionId: sid, deviceId } = parsed.data
    let fbUid: string
    try { fbUid = (await verifyToken(idToken)).uid } catch { ws.close(4001, 'Token verification failed'); return }
    const resolved = await resolveUserId(fbUid)
    if (!resolved) { ws.close(4001, 'User not found'); return }
    if (!(await validateDevice(resolved, deviceId))) { ws.close(4001, 'Unknown device'); return }

    const session = await fs.getSession(resolved, sid)
    if (session.status === 'closed' || session.status === 'aborted') {
      ws.close(4001, 'Session closed')
      return
    }

    firebaseUid = resolved; sessionId = sid; authed = true
    clearTimeout(authTimer)

    const pendingTask = await fs.getFirstTask(firebaseUid, sid)
    if (!pendingTask) { ws.close(4001, 'No pending task'); return }

    await fs.markBrowserConnected(firebaseUid, sid, options.instanceId, pendingTask.intent.taskId)
    sessionBridge.registerBrowser(firebaseUid, sid, ws)
    ws.send(JSON.stringify({ type: 'session_ready', sessionId: sid }))
    ws.send(JSON.stringify({ type: 'task', intent: pendingTask.intent }))
  }

  async function onResult(raw: unknown): Promise<void> {
    if (!authed || !firebaseUid || !sessionId) return
    const r = resultFrameSchema.safeParse(raw)
    if (r.success) {
      const result: TaskResult = { taskId: r.data.taskId, status: 'complete', data: r.data.data, activeUrl: r.data.activeUrl }
      await fs.writeTaskResult(firebaseUid, sessionId, r.data.taskId, result)
      ws.send(JSON.stringify({ type: 'session_end' }))
      return
    }
    const e = taskErrorFrameSchema.safeParse(raw)
    if (e.success) {
      const result: TaskResult = {
        taskId: e.data.taskId, status: 'failed', data: {}, activeUrl: '',
        error: {
          code: e.data.code,
          message: e.data.message,
          failedAction: e.data.failedAction,
        },
      }
      await fs.writeTaskResult(firebaseUid, sessionId, e.data.taskId, result)
      ws.send(JSON.stringify({ type: 'session_end' }))
    }
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
  })

  ws.on('close', () => {
    clearTimeout(authTimer)
    if (firebaseUid && sessionId) sessionBridge.deregisterBrowser(firebaseUid, sessionId)
  })
  ws.on('error', () => { clearTimeout(authTimer) })
}
