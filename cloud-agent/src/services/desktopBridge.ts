import type { WebSocket } from 'ws'

export interface DesktopConnection {
  ws: WebSocket
  generation: number
}

const key = (uid: string, deviceId: string) => `${uid}:${deviceId}`

// Mirrors sessionBridge.ts: per-instance module singleton, no cross-instance state.
// The generation guard exists so a stale socket's deferred `close` event cannot
// deregister (and mark offline) a connection that has already been replaced.
export function createDesktopBridge() {
  const map = new Map<string, DesktopConnection>()
  let nextGeneration = 1
  return {
    /** Registers ws for uid:deviceId, closing any previous socket. Returns the generation. */
    register(uid: string, deviceId: string, ws: WebSocket): number {
      const k = key(uid, deviceId)
      const prev = map.get(k)
      const generation = nextGeneration++
      // Store the replacement before closing the previous socket so its synchronous
      // `close` handler sees the new generation and deregister is a no-op (spec §5).
      map.set(k, { ws, generation })
      if (prev) {
        try { prev.ws.close(4000, 'Replaced by new connection') } catch { /* ignore */ }
      }
      return generation
    },
    get(uid: string, deviceId: string): DesktopConnection | undefined {
      return map.get(key(uid, deviceId))
    },
    /** Removes the entry only if `generation` still owns it. Returns whether removed. */
    deregister(uid: string, deviceId: string, generation: number): boolean {
      const k = key(uid, deviceId)
      const cur = map.get(k)
      if (!cur || cur.generation !== generation) return false
      map.delete(k)
      return true
    },
  }
}

export type DesktopBridge = ReturnType<typeof createDesktopBridge>

// Module-level singleton — one map per Cloud Run instance.
export const desktopBridge: DesktopBridge = createDesktopBridge()
