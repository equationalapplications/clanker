import type { WebSocket } from 'ws'
import { WebSocket as WS } from 'ws'
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
  let authInFlight = false
  let uid: string | null = null
  let deviceId: string | null = null
  let generation = 0
  let unsubPending: (() => void) | null = null
  let unsubDevice: (() => void) | null = null
  let lastTouch = 0
  let deviceDocGone = false
  const dispatched = new Set<string>()

  function socketOpen(): boolean {
    return ws.readyState === WS.OPEN
  }

  const authTimer = setTimeout(() => {
    if (!authed && socketOpen()) ws.close(4001, 'Auth timeout')
  }, authTimeoutMs)

  function runDisconnectPath(): void {
    if (!authed || !uid || !deviceId) return
    const ownsRegistration = bridge.deregister(uid, deviceId, generation)

    // Always clean up local listeners/state, even if a newer connection replaced this socket.
    unsubPending?.()
    unsubPending = null
    unsubDevice?.()
    unsubDevice = null

    if (ownsRegistration && !deviceDocGone) {
      void fs.markDesktopDeviceOffline(uid, deviceId, options.instanceId).catch(() => {
        /* liveness bound covers */
      })
    }
    if (ownsRegistration) {
      for (const taskId of dispatched) {
        void fs
          .failDesktopTaskIfUnresolved(uid, taskId, {
            code: 'DESKTOP_DISCONNECTED',
            message: 'Desktop connection lost mid-call',
          })
          .catch(() => {
            /* caller timeout covers */
          })
      }
    }
    dispatched.clear()
  }

  async function onAuth(raw: unknown): Promise<void> {
    if (authed || authInFlight) return
    const parsed = desktopAuthSchema.safeParse(raw)
    if (!parsed.success) {
      ws.close(4001, 'Invalid auth frame')
      return
    }
    authInFlight = true
    try {
      const resolved = await options.resolvePairingToken(parsed.data.pairingToken)
      if (!socketOpen()) return
      if (!resolved) {
        ws.close(4001, 'Unknown pairing token')
        return
      }
      const device = await fs.getDesktopDeviceDoc(resolved.uid, resolved.deviceId)
      if (!socketOpen()) return
      if (!device.exists || device.isPaused) {
        ws.close(4001, 'Device unavailable')
        return
      }

      uid = resolved.uid
      deviceId = resolved.deviceId
      authed = true
      clearTimeout(authTimer)

      // Single dispatch path for both the pending-queue listener and the
      // same-instance shortcut (desktopBridge.get().dispatchTask): every task
      // sent over this socket enters `dispatched`, so the disconnect path can
      // fail it immediately, and concurrent dispatch attempts dedupe here.
      const dispatchTask = (
        taskId: string,
        tool: string,
        params: Record<string, unknown>,
      ): boolean => {
        if (dispatched.has(taskId)) return false
        if (!socketOpen()) {
          void fs
            .failDesktopTaskIfUnresolved(uid!, taskId, {
              code: 'DESKTOP_DISCONNECTED',
              message: 'Desktop connection lost mid-call',
            })
            .catch(() => {
              /* caller timeout covers */
            })
          return false
        }
        dispatched.add(taskId)
        // Send frame immediately; markDesktopTaskExecuting race is handled below
        ws.send(JSON.stringify({ type: 'task', taskId, tool, params }))
        void fs
          .markDesktopTaskExecuting(uid!, taskId)
          .then((ok) => {
            if (!ok) {
              // Task already terminal (race with disconnect). Best-effort remove frame.
              try {
                ws.send(JSON.stringify({ type: 'cancel_task', taskId }))
              } catch {
                /* ignore */
              }
            }
          })
          .catch((err) => {
            dispatched.delete(taskId)
            console.error('[desktop-bridge] dispatch failed:', taskId, err)
          })
        return true
      }

      generation = bridge.register(uid, deviceId, ws, dispatchTask)
      await fs.markDesktopDeviceOnline(uid, deviceId, options.instanceId)
      if (!socketOpen()) return
      lastTouch = Date.now()

      unsubPending = fs.watchPendingDesktopTasks(uid, deviceId, (tasks) => {
        for (const task of tasks) {
          dispatchTask(task.taskId, task.tool, task.params)
        }
      })

      unsubDevice = fs.watchDesktopDeviceDoc(uid, deviceId, (doc) => {
        if (!doc.exists || doc.isPaused) {
          deviceDocGone = !doc.exists
          if (socketOpen()) ws.close(4001, doc.exists ? 'Device paused' : 'Device revoked')
        }
      })

      if (socketOpen()) ws.send(JSON.stringify({ type: 'ready' }))
    } finally {
      if (!authed) authInFlight = false
    }
  }

  async function onResult(raw: unknown): Promise<void> {
    if (!authed || !uid) return
    const r = taskResultSchema.safeParse(raw)
    if (r.success) {
      dispatched.delete(r.data.taskId)
      const written = await fs.writeDesktopTaskResult(uid, r.data.taskId, {
        status: 'complete',
        result: r.data.result,
      })
      if (!written)
        console.warn(
          '[desktop-bridge] result write rejected for unknown/terminal task:',
          r.data.taskId,
        )
      return
    }
    const e = taskErrorSchema.safeParse(raw)
    if (e.success) {
      dispatched.delete(e.data.taskId)
      const written = await fs.writeDesktopTaskResult(uid, e.data.taskId, {
        status: 'failed',
        error: { code: 'TOOL_ERROR', message: e.data.error.message },
      })
      if (!written)
        console.warn(
          '[desktop-bridge] error write rejected for unknown/terminal task:',
          e.data.taskId,
        )
      return
    }
    console.warn('[desktop-bridge] dropped malformed post-auth frame')
  }

  ws.on('message', (data: Buffer) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(data.toString())
    } catch {
      if (authed) console.warn('[desktop-bridge] dropped non-JSON frame')
      return
    }

    if (pingSchema.safeParse(parsed).success) {
      if (socketOpen()) ws.send(JSON.stringify({ type: 'pong' }))
      if (authed && uid && deviceId && Date.now() - lastTouch >= lastSeenRefreshMs) {
        lastTouch = Date.now()
        void fs.touchDesktopDeviceLastSeen(uid, deviceId).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          if (msg === 'DEVICE_NOT_FOUND') {
            deviceDocGone = true
            if (socketOpen()) ws.close(4001, 'Device revoked or unavailable')
            return
          }
          console.error('[desktop-bridge] lastSeen touch failed:', err)
        })
      }
      return
    }

    if (!authed) {
      void onAuth(parsed).catch(() => {
        if (socketOpen()) ws.close(1011, 'Internal error')
      })
      return
    }

    const type = (parsed as { type?: string }).type
    if (type === 'task_result' || type === 'task_error') {
      void onResult(parsed).catch((err) =>
        console.error('[desktop-bridge] result write failed:', err),
      )
    } else {
      console.warn('[desktop-bridge] dropped malformed post-auth frame:', type)
    }
  })

  ws.on('close', () => {
    clearTimeout(authTimer)
    runDisconnectPath()
  })
  ws.on('error', () => {
    clearTimeout(authTimer)
    runDisconnectPath()
  })
}
