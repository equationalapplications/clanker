/**
 * Proactive-message sync orchestrator (Task 10 of Phase 2).
 *
 * Drives the incremental pull loop:
 *   1. Read the cursor from `sync_state` (Task 9 storage).
 *   2. Call the server-side `fetchProactiveMessages` callable (Task 7) with the
 *      cursor halves.
 *   3. Apply the page to local SQLite AND advance the cursor IN THE SAME
 *      TRANSACTION as the inserts. A crash mid-page rolls both back — no
 *      message is skipped, no cursor drift.
 *   4. Loop while the server's `nextCursor` is non-null.
 */

import { applyProactiveMessages } from '~/database/messageDatabase'
import { getDatabase } from '~/database'
import { PROACTIVE_SYNC_CURSOR_KEY } from '~/constants/proactive'
import { getSyncCursor, setSyncCursor, type SyncCursor } from '~/database/syncState'
import { fetchProactiveMessagesFn } from '~/config/firebaseConfig'

/**
 * Drain the proactive-message queue for the current user into local SQLite.
 *
 * `userId` is the authenticated uid. The wire payload does not carry it, but
 * the local rows cannot be written without it — see applyProactiveMessages.
 *
 * Safe to call repeatedly: the server's cursor + the local INSERT OR IGNORE
 * make this idempotent. Loops while the server reports a non-null `nextCursor`
 * (page boundary); bails out on a 0-row page even if `nextCursor` is set, to
 * avoid an infinite loop if the cursor advances without producing messages.
 */
export async function syncProactiveMessages(userId: string): Promise<string[]> {
  let cursor: SyncCursor | null = await getSyncCursor(PROACTIVE_SYNC_CURSOR_KEY)
  const db = await getDatabase()
  // Characters this run actually wrote rows for, so the caller can invalidate
  // exactly those thread caches instead of every cached conversation.
  const touchedCharacterIds = new Set<string>()

  // Capped so a stuck server (returns nextCursor but never produces rows)
  // cannot loop forever. The server's PROACTIVE_SYNC_PAGE_LIMIT caps the
  // per-call batch; this caps the total number of calls.
  const MAX_PAGES = 50
  let pagesProcessed = 0

  while (pagesProcessed < MAX_PAGES) {
    const result = await fetchProactiveMessagesFn({
      sinceCreatedAt: cursor?.createdAt,
      sinceMessageId: cursor?.messageId,
    })
    const { messages, nextCursor } = result.data

    if (messages.length === 0) {
      // No new messages on this page. Advance the cursor anyway so we don't
      // re-fetch the same empty window — the cursor advance is still in the
      // same transaction so a crash before commit re-reads the same page next
      // time (idempotent because the SELECT on the server is already a
      // strict-greater-than).
      if (nextCursor) {
        await db.withTransactionAsync(async () => {
          await setSyncCursor(PROACTIVE_SYNC_CURSOR_KEY, nextCursor, db)
        })
        cursor = nextCursor
      }
      return Array.from(touchedCharacterIds)
    }

    let appliedLocalIds: string[] = []
    await db.withTransactionAsync(async () => {
      appliedLocalIds = await applyProactiveMessages(messages, userId, db)
      // Cursor advance inside the same transaction as the inserts. A crash
      // mid-page rolls both back — no message is skipped, no cursor drift.
      // On a final page the server omits nextCursor, so advance to the last
      // applied message instead of rewriting the previous cursor. cursor!
      // would also hide a first-sync null from the type system; both ends of
      // the coalesce now carry real SyncCursor data.
      const last = messages[messages.length - 1]
      const advanced: SyncCursor = nextCursor ?? {
        createdAt: last.createdAt,
        messageId: last.messageId,
      }
      await setSyncCursor(PROACTIVE_SYNC_CURSOR_KEY, advanced, db)
    })

    // Recorded only after the transaction commits, so a rolled-back page never
    // reports threads it did not actually write.
    // applyProactiveMessages resolves the wire payload's cloud character UUID
    // to the LOCAL characters.id it actually wrote under. Adding msg.characterId
    // here instead would invalidate cache keys that no query ever uses for any
    // character whose local id diverges from its cloud_id.
    for (const localId of appliedLocalIds) {
      touchedCharacterIds.add(localId)
    }

    if (!nextCursor) {
      return Array.from(touchedCharacterIds)
    }

    cursor = nextCursor
    pagesProcessed++
  }

  return Array.from(touchedCharacterIds)
}
