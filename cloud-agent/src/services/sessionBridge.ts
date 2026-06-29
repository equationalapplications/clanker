import type { WebSocket } from 'ws'

export interface SessionState {
  sessionId: string
  voiceWs: WebSocket | null
  browserWs: WebSocket | null
  firestoreUnsub: (() => void) | null
}

const key = (uid: string, sessionId: string) => `${uid}:${sessionId}`

export function createSessionBridge() {
  const map = new Map<string, SessionState>()
  function ensure(uid: string, sessionId: string): SessionState {
    const k = key(uid, sessionId)
    let s = map.get(k)
    if (!s) { s = { sessionId, voiceWs: null, browserWs: null, firestoreUnsub: null }; map.set(k, s) }
    return s
  }
  return {
    registerBrowser(uid: string, sessionId: string, ws: WebSocket): void { ensure(uid, sessionId).browserWs = ws },
    registerVoice(uid: string, sessionId: string, ws: WebSocket): void { ensure(uid, sessionId).voiceWs = ws },
    getSession(uid: string, sessionId: string): SessionState | undefined { return map.get(key(uid, sessionId)) },
    deregister(uid: string, sessionId: string): void {
      const s = map.get(key(uid, sessionId))
      try { s?.firestoreUnsub?.() } catch { /* ignore */ }
      map.delete(key(uid, sessionId))
    },
  }
}

export type SessionBridge = ReturnType<typeof createSessionBridge>

// Module-level singleton — one map per Cloud Run instance.
export const sessionBridge: SessionBridge = createSessionBridge()
