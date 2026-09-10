import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useFocusEffect } from 'expo-router'
import { getDatabase } from '~/database/index'
import { countUnreadProactive, markProactiveReadLocally } from '~/database/messageDatabase'
import { enqueueMarkRead, flushMarkReadQueue } from '~/services/proactiveReadQueue'
import { markProactiveReadViaCallable } from '~/services/proactiveMarkReadService'
import { proactiveUnreadKeys } from '~/hooks/useProactiveUnread'

/**
 * Decision 4: on chat focus, clear the dot optimistically (local read_at write +
 * cache invalidation) and hand the ids to the durable mark-read queue. The dot
 * clears the moment the chat gains focus, not after a server round-trip.
 *
 * useFocusEffect, not useEffect: the Expo Router 57 stack and tab screens stay
 * mounted when blurred, so returning to the same chat does not rerun a plain
 * useEffect. A proactive message received while the chat was blurred would
 * otherwise sit marked-unread on refocus. The effect runs on every focus,
 * which is also the natural place for a "second open is a no-op" check — the
 * unread count is 0 because the previous focus cleared it.
 *
 * The local read_at write and the queue write share one SQLite transaction so
 * a queue persistence failure cannot strand ids whose rows are already marked
 * read — the next focus would find zero unread and reconstruct nothing.
 */
export function useMarkProactiveReadOnOpen(characterId: string | null | undefined): void {
  const queryClient = useQueryClient()

  useFocusEffect(
    useCallback(() => {
      if (!characterId) return
      let cancelled = false
      void (async () => {
        const unread = await countUnreadProactive(characterId, Date.now())
        if (unread === 0 || cancelled) return
        const db = await getDatabase()
        // Atomic commit: the messages UPDATE (read_at) and the sync_state
        // INSERT OR REPLACE (queue blob) land in the same transaction. A
        // failure after the UPDATE rolls it back; the rows are still unread
        // and the next focus retries the full pair.
        let ids: string[] = []
        await db.withTransactionAsync(async () => {
          ids = await markProactiveReadLocally(characterId, db)
          if (ids.length > 0) {
            await enqueueMarkRead(ids, undefined, db)
          }
        })
        if (cancelled || ids.length === 0) return
        // Kick the flush only after the transaction commits. Fire-and-forget:
        // the durable queue's retry budget + foreground flushes cover the
        // failures, and the cancellation guard above only blocks UI
        // side-effects.
        void flushMarkReadQueue(markProactiveReadViaCallable).catch(() => {})
        if (cancelled) return
        await queryClient.invalidateQueries({ queryKey: proactiveUnreadKeys.all })
      })().catch((error: unknown) => {
        console.warn('[proactiveRead] mark-read on focus failed:', error)
      })
      return () => {
        cancelled = true
      }
    }, [characterId, queryClient]),
  )
}
