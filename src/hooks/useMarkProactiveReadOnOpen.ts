import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { countUnreadProactive, markProactiveReadLocally } from '~/database/messageDatabase'
import { enqueueMarkRead } from '~/services/proactiveReadQueue'
import { markProactiveReadViaCallable } from '~/services/proactiveMarkReadService'
import { proactiveUnreadKeys } from '~/hooks/useProactiveUnread'

/**
 * Decision 4: on chat open, clear the dot optimistically (local read_at write +
 * cache invalidation) and hand the ids to the durable mark-read queue. The dot
 * clears the moment the chat opens, not after a server round-trip.
 */
export function useMarkProactiveReadOnOpen(characterId: string | null | undefined): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!characterId) return
    let cancelled = false
    void (async () => {
      const unread = await countUnreadProactive(characterId, Date.now())
      if (unread === 0 || cancelled) return
      const ids = await markProactiveReadLocally(characterId)
      if (ids.length === 0) return
      // The local rows are already read; the receipt must reach the server
      // even if this effect was cancelled meanwhile. The durable queue's
      // retry budget covers transient failures, so we kick it before the
      // cancellation guard that only blocks UI side-effects.
      await enqueueMarkRead(ids, markProactiveReadViaCallable)
      if (cancelled) return
      await queryClient.invalidateQueries({ queryKey: proactiveUnreadKeys.all })
    })().catch((error: unknown) => {
      console.warn('[proactiveRead] mark-read on open failed:', error)
    })
    return () => {
      cancelled = true
    }
  }, [characterId, queryClient])
}
