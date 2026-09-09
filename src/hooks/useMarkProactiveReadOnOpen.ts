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
      if (cancelled || ids.length === 0) return
      await queryClient.invalidateQueries({ queryKey: proactiveUnreadKeys.all })
      await enqueueMarkRead(ids, markProactiveReadViaCallable)
    })().catch((error: unknown) => {
      console.warn('[proactiveRead] mark-read on open failed:', error)
    })
    return () => {
      cancelled = true
    }
  }, [characterId, queryClient])
}