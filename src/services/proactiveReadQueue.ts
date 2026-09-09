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
 * Flush wiring: `enqueueMarkRead` with a `call` both persists the intent AND
 * kicks a fire-and-forget flush, so opening a chat reaches the server promptly
 * without waiting for the next foreground event. The hook layer (`useProactiveSync`)
 * also flushes after each successful `syncProactiveMessages` run; foreground
 * flushes via `AppState` cover the case where the app comes back from the
 * background while ids are still queued.
 *
 * Concurrency: getSyncJson and setSyncJson are separate awaits, so two
 * enqueues can interleave (enqueue A reads, enqueue B reads, A writes, B
 * writes — B's later write overwrites A's earlier append), and a flush can
 * drop ids enqueued during its in-flight call (flush reads ['m1'], the call
 * succeeds for m1, an enqueue persists ['m1', 'm2'], the flush then writes
 * [] — m2 is lost). A single promise-chain mutex serializes the read-modify-
 * write; the flush removes only its snapshot on success so a concurrent
 * enqueue survives.
 */

import { PROACTIVE_READ_QUEUE_KEY } from '~/constants/proactive'
import { getSyncJson, setSyncJson } from '~/database/syncState'

/**
 * Wire shape for the server-side callable. Matches the request/response types
 * declared in functions/src/proactiveMessages.ts. The `call` parameter is
 * injected so tests can substitute a mock — the real binding
 * (`markProactiveReadViaCallable`) lives in `proactiveMarkReadService.ts` and
 * is shared by `useProactiveSync` and the chat-open enqueue (Task 8).
 */
export type MarkReadCall = (request: { messageIds: string[] }) => Promise<{ updated: number }>

const MAX_FLUSH_ATTEMPTS = 3

// Promise-chain mutex. Each call chains onto the previous, so the critical
// read-modify-write sections of enqueue and flush run one at a time even
// though their awaits can interleave at the event loop.
let queueLock: Promise<unknown> = Promise.resolve()

async function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = queueLock
  let release: () => void = () => {}
  let abort: (err: unknown) => void = () => {}
  queueLock = new Promise<void>((res, rej) => {
    release = res
    abort = rej
  })
  try {
    await prev
    return await fn()
  } finally {
    release()
    // Swallow late rejections from previous holders so the chain stays healthy
    // even if a thrown error reaches here after the holder already caught it.
    queueLock.catch(abort)
  }
}

async function readQueue(): Promise<string[]> {
  return (await getSyncJson<string[]>(PROACTIVE_READ_QUEUE_KEY)) ?? []
}

/**
 * Append ids to the persistent queue. Deduplicates against the existing queue
 * — adding the same id twice is a no-op so a chat page that opens, closes, and
 * re-opens (each generating a mark-read intent) cannot double-count server
 * updates on flush.
 *
 * When a `call` is provided, an enqueue both persists the intent AND kicks a
 * flush, so a chat open reaches the server promptly. The flush is
 * fire-and-forget — flush failures stay queued (retry budget + foreground
 * flushes cover them).
 */
export async function enqueueMarkRead(messageIds: string[], call?: MarkReadCall): Promise<void> {
  await withQueueLock(async () => {
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
  })
  // The wiring this docstring anticipated: an enqueue with a call both persists
  // the intent AND kicks a flush, so a chat open reaches the server promptly.
  // Fire-and-forget — flush failures stay queued (retry budget + foreground
  // flushes cover them).
  if (call && messageIds.length > 0) {
    void flushMarkReadQueue(call).catch(() => {})
  }
}

/**
 * Send every queued id to the server. Retries up to MAX_FLUSH_ATTEMPTS within
 * a single flush, then leaves the queue intact for the next flush (the app
 * foreground hook / after-sync trigger) if every attempt failed.
 *
 * On success the snapshot — the ids sent in this flush — is removed, but ids
 * enqueued while the call was in flight are preserved. Only that snapshot's
 * set is subtracted from the queue, not the whole queue, so a concurrent
 * enqueue survives. The whole read-modify-write is wrapped in the queue
 * lock so the snapshot subtraction cannot interleave with another enqueue.
 *
 * Errors are swallowed; a flush is best-effort and the queue survives until a
 * later flush succeeds. A `await flushMarkReadQueue(call)` from the foreground
 * hook is exactly the recovery path.
 */
export async function flushMarkReadQueue(call: MarkReadCall): Promise<void> {
  await withQueueLock(async () => {
    const queue = await readQueue()
    if (queue.length === 0) {
      return
    }
    const snapshot = queue.slice()

    for (let attempt = 0; attempt < MAX_FLUSH_ATTEMPTS; attempt++) {
      try {
        await call({ messageIds: snapshot })
        // Success — drop only the snapshot, not anything enqueued during the
        // in-flight call. Re-read inside the same lock so a concurrent
        // enqueue's write is visible.
        const current = await readQueue()
        if (current.length === 0) {
          return
        }
        const snapshotSet = new Set(snapshot)
        const remaining = current.filter((id) => !snapshotSet.has(id))
        if (remaining.length === current.length) {
          // Nothing matched the snapshot — every id was already removed by
          // an earlier successful flush. Leave the queue untouched.
          return
        }
        await setSyncJson(PROACTIVE_READ_QUEUE_KEY, remaining)
        return
      } catch {
        // Queue is unchanged — these ids are still pending and will be retried
        // either by the next internal attempt or by the next external flush.
      }
    }
  })
}
