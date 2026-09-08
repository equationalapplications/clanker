/**
 * Persistent retry queue for `markProactiveRead` (Task 11 of Phase 2).
 *
 * The server-side `markProactiveRead` callable (Task 8) records the read
 * receipt for proactive messages. A dropped receipt is silent and severe: the
 * server then believes the user is ignoring this character and suppresses every
 * future push from it. So we never drop a queued id — every enqueue is durable
 * in the `sync_state` table (Task 9 storage) and every flush retries until it
 * succeeds or the retry budget is exhausted.
 *
 * Flush wiring (calling this on app foreground and after each successful sync)
 * is intentionally left to a future task — T11 only exposes the two functions.
 */

import { PROACTIVE_READ_QUEUE_KEY } from '~/constants/proactive'
import { getSyncJson, setSyncJson } from '~/database/syncState'

/**
 * Wire shape for the server-side callable. Matches the request/response types
 * declared in functions/src/proactiveMessages.ts. The `call` parameter is
 * injected so tests can substitute a mock — wiring the real
 * `httpsCallable('markProactiveRead')` happens in a future task.
 */
export type MarkReadCall = (request: { messageIds: string[] }) => Promise<{ updated: number }>

const MAX_FLUSH_ATTEMPTS = 3

async function readQueue(): Promise<string[]> {
  return (await getSyncJson<string[]>(PROACTIVE_READ_QUEUE_KEY)) ?? []
}

/**
 * Append ids to the persistent queue. Deduplicates against the existing queue
 * — adding the same id twice is a no-op so a chat page that opens, closes, and
 * re-opens (each generating a mark-read intent) cannot double-count server
 * updates on flush.
 *
 * The `_call` parameter is accepted for symmetry with `flushMarkReadQueue` and
 * for the future wiring that will both enqueue AND kick a flush; today it is
 * unused.
 */
export async function enqueueMarkRead(messageIds: string[], _call?: MarkReadCall): Promise<void> {
  const current = await readQueue()
  const seen = new Set(current)
  const merged = current.slice()
  let appended = false
  for (const id of messageIds) {
    if (!seen.has(id)) {
      seen.add(id)
      merged.push(id)
      appended = true
    }
  }
  if (appended) {
    await setSyncJson(PROACTIVE_READ_QUEUE_KEY, merged)
  }
}

/**
 * Send every queued id to the server. Retries up to MAX_FLUSH_ATTEMPTS within
 * a single flush, then leaves the queue intact for the next flush (the app
 * foreground hook / after-sync trigger) if every attempt failed.
 *
 * On success the entire queue is cleared — the server returned `{ updated: n }`
 * for the whole batch, so the client has nothing left to prove.
 *
 * Errors are swallowed; a flush is best-effort and the queue survives until a
 * later flush succeeds. A `await flushMarkReadQueue(call)` from the foreground
 * hook is exactly the recovery path.
 */
export async function flushMarkReadQueue(call: MarkReadCall): Promise<void> {
  let queue = await readQueue()
  if (queue.length === 0) {
    return
  }

  for (let attempt = 0; attempt < MAX_FLUSH_ATTEMPTS; attempt++) {
    try {
      await call({ messageIds: queue })
      await setSyncJson(PROACTIVE_READ_QUEUE_KEY, [])
      return
    } catch {
      // Queue is unchanged — these ids are still pending and will be retried
      // either by the next internal attempt or by the next external flush.
    }
  }
}
