import type { TaskIntent, TaskResult } from '../shared/dsl-types.js'

interface SocketLike {
  readyState: number
  onopen: (() => void) | null
  onmessage: ((e: { data: string }) => void) | null
  onclose: (() => void) | null
  send(data: string): void
  close(): void
}

export interface WsClientOpts {
  url: string
  idToken: string
  sessionId: string
  deviceId: string
  onTask: (intent: TaskIntent) => void
  onSessionEnd: () => void
  onSessionReady?: () => void
  WebSocketImpl?: new (url: string) => SocketLike
  pingIntervalMs?: number
}

export function createWsClient(opts: WsClientOpts) {
  const Impl = opts.WebSocketImpl ?? (WebSocket as unknown as new (url: string) => SocketLike)
  const pingMs = opts.pingIntervalMs ?? 20_000
  let sock: SocketLike | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null

  function stopPing() { if (pingTimer) { clearInterval(pingTimer); pingTimer = null } }

  return {
    connect() {
      sock = new Impl(opts.url)
      sock.onopen = () => {
        sock!.send(JSON.stringify({ type: 'auth', idToken: opts.idToken, sessionId: opts.sessionId, deviceId: opts.deviceId }))
        pingTimer = setInterval(() => { try { sock?.send(JSON.stringify({ type: 'ping' })) } catch { /* ignore */ } }, pingMs)
      }
      sock.onmessage = (e) => {
        let msg: { type?: string; intent?: TaskIntent }
        try { msg = JSON.parse(e.data) } catch { return }
        if (msg.type === 'task' && msg.intent) opts.onTask(msg.intent)
        else if (msg.type === 'session_ready') opts.onSessionReady?.()
        else if (msg.type === 'session_end') { stopPing(); opts.onSessionEnd() }
      }
      sock.onclose = () => { stopPing() }
    },
    sendResult(result: TaskResult) {
      if (result.status === 'complete') {
        sock?.send(JSON.stringify({ type: 'task_result', taskId: result.taskId, data: result.data, activeUrl: result.activeUrl }))
      } else {
        sock?.send(JSON.stringify({ type: 'task_error', taskId: result.taskId, code: result.error?.code, message: result.error?.message, failedAction: result.error?.failedAction }))
      }
    },
    sendAwaitingAuth(taskId: string, haltedStepIndex: number): void {
      sock?.send(JSON.stringify({ type: 'awaiting_auth', taskId, haltedStepIndex }))
    },
    close() { stopPing(); try { sock?.close() } catch { /* ignore */ } },
  }
}
