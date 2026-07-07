import type { WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import { z } from 'zod'
import type { FirestoreSession } from '../services/firestoreSession.js'
import type { DesktopBridge } from '../services/desktopBridge.js'

const desktopAuthSchema = z.object({
  type: z.literal('auth'),
  pairingToken: z.string().min(1).max(128),
})

const pingSchema = z.object({ type: z.literal('ping') })

const taskResultSchema = z.object({
  type: z.literal('task_result'),
  taskId: z.string().min(1),
  result: z.unknown(),
})

const taskErrorSchema = z.object({
  type: z.literal('task_error'),
  taskId: z.string().min(1),
  error: z.object({ code: z.string(), message: z.string() }),
})

export interface DesktopWsOptions {
  firestoreSession: FirestoreSession
  desktopBridge: DesktopBridge
  resolvePairingToken: (rawToken: string) => Promise<{ uid: string; deviceId: string } | null>
  instanceId: string
  authTimeoutMs?: number
  /** Spec §5: refresh lastSeenAt at most every 40s (every other 20s heartbeat). */
  lastSeenRefreshMs?: number
}

export function handleDesktopWsUpgrade(
  ws: WebSocket,
  _req: IncomingMessage,
  options: DesktopWsOptions,
): void {
  const fs = options.firestoreSession
  const bridge = options.desktopBridge
  const authTimeoutMs = options.authTimeoutMs ?? 5000
  const lastSeenRefreshMs = options.lastSeenRefreshMs ?? 40_000

  let authed = false
  let uid: string | null = null
  let deviceId: string | null = null
  let generation = 0
  let unsubPending: (() => void) | null = null
  let unsubDevice: (() => void) | null = null
  let lastTouch = 0
  let deviceDocGone = false
  const dispatched = new Set<string>()

  const authTimer = setTimeout(() => {
    if (!authed && ws.readyState === ws.OPEN) ws.close(4001, 'Auth timeout')
  }, authTimeoutMs)

  function runDisconnectPath(): void {
    if (!authed || !uid || !deviceId) return
    if (!bridge.deregister(uid, deviceId, generation)) return
    unsubPending?.()
    unsubPending = null
    unsubDevice?.()
    unsubDevice = null
    if (!deviceDocGone) {
      void fs.markDesktopDeviceOffline(uid, deviceId).catch(() => { /* liveness bound covers */ })
    }
    for (const taskId of dispatched) {
      void fs.failDesktopTaskIfUnresolved(uid, taskId, {
        code: 'DESKTOP_DISCONNECTED', message: 'Desktop connection lost mid-call',
      }).catch(() => { /* caller timeout covers */ })
    }
    dispatched.clear()
  }

  async function onAuth(raw: unknown): Promise<void> {
    const parsed = desktopAuthSchema.safeParse(raw)
    if (!parsed.success) { ws.close(4001, 'Invalid auth frame'); return }
    const resolved = await options.resolvePairingToken(parsed.data.pairingToken)
    if (!resolved) { ws.close(4001, 'Unknown pairing token'); return }
    const device = await fs.getDesktopDeviceDoc(resolved.uid, resolved.deviceId)
    if (!device.exists || device.isPaused) { ws.close(4001, 'Device unavailable'); return }

    uid = resolved.uid; deviceId = resolved.deviceId; authed = true
    clearTimeout(authTimer)

    generation = bridge.register(uid, deviceId, ws)
    await fs.markDesktopDeviceOnline(uid, deviceId, options.instanceId)
    lastTouch = Date.now()

    unsubPending = fs.watchPendingDesktopTasks(uid, deviceId, (tasks) => {
      for (const task of tasks) {
        if (dispatched.has(task.taskId)) continue
        dispatched.add(task.taskId)
        void fs.markDesktopTaskExecuting(uid!, task.taskId)
          .then(() => {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({
                type: 'task', taskId: task.taskId, tool: task.tool, params: task.params,
              }))
            }
          })
          .catch((err) => console.error('[desktop-bridge] dispatch failed:', task.taskId, err))
      }
    })

    unsubDevice = fs.watchDesktopDeviceDoc(uid, deviceId, (doc) => {
      if (!doc.exists || doc.isPaused) {
        deviceDocGone = !doc.exists
        if (ws.readyState === ws.OPEN) ws.close(4001, doc.exists ? 'Device paused' : 'Device revoked')
      }
    })

    ws.send(JSON.stringify({ type: 'ready' }))
  }

  async function onResult(raw: unknown): Promise<void> {
    if (!authed || !uid) return
    const r = taskResultSchema.safeParse(raw)
    if (r.success) {
      dispatched.delete(r.data.taskId)
      await fs.writeDesktopTaskResult(uid, r.data.taskId, { status: 'complete', result: r.data.result })
      return
    }
    const e = taskErrorSchema.safeParse(raw)
    if (e.success) {
      dispatched.delete(e.data.taskId)
      await fs.writeDesktopTaskResult(uid, e.data.taskId, {
        status: 'failed',
        error: { code: 'TOOL_ERROR', message: e.data.error.message },
      })
      return
    }
    console.warn('[desktop-bridge] dropped malformed post-auth frame')
  }

  ws.on('message', (data: Buffer) => {
    let parsed: unknown
    try { parsed = JSON.parse(data.toString()) } catch {
      if (authed) console.warn('[desktop-bridge] dropped non-JSON frame')
      return
    }

    if (pingSchema.safeParse(parsed).success) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'pong' }))
      if (authed && uid && deviceId && Date.now() - lastTouch >= lastSeenRefreshMs) {
        lastTouch = Date.now()
        void fs.touchDesktopDeviceLastSeen(uid, deviceId).catch(() => {
          deviceDocGone = true
          if (ws.readyState === ws.OPEN) ws.close(4001, 'Device revoked or unavailable')
        })
      }
      return
    }

    if (!authed) {
      void onAuth(parsed).catch(() => { if (ws.readyState === ws.OPEN) ws.close(1011, 'Internal error') })
      return
    }

    const type = (parsed as { type?: string }).type
    if (type === 'task_result' || type === 'task_error') {
      void onResult(parsed).catch((err) => console.error('[desktop-bridge] result write failed:', err))
    } else {
      console.warn('[desktop-bridge] dropped malformed post-auth frame:', type)
    }
  })

  ws.on('close', () => {
    clearTimeout(authTimer)
    runDisconnectPath()
  })
  ws.on('error', () => { clearTimeout(authTimer) })
}
