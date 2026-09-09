import { useCallback, useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import * as Notifications from 'expo-notifications'
import { useQueryClient } from '@tanstack/react-query'
import { syncProactiveMessages } from '~/services/proactiveSync'
import { flushMarkReadQueue } from '~/services/proactiveReadQueue'
import { markProactiveReadViaCallable } from '~/services/proactiveMarkReadService'
import { proactiveUnreadKeys } from '~/hooks/useProactiveUnread'
import { messageKeys } from '~/hooks/useMessages'

export const PROACTIVE_PUSH_TYPE = 'PROACTIVE_CHARACTER_MESSAGE'

export function isProactivePushData(data: unknown): data is { deepLink?: unknown } {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === PROACTIVE_PUSH_TYPE
  )
}

/**
 * Decision 3: sync on foreground and on foreground receipt, one in-flight run,
 * invalidate the badge + thread caches on completion. Task 7's routing hook
 * reuses triggerSync for notification taps.
 */
export function useProactiveSync(userId: string | null | undefined): { triggerSync: () => void } {
  const queryClient = useQueryClient()
  const inFlightRef = useRef<Promise<void> | null>(null)

  const triggerSync = useCallback(() => {
    if (!userId || inFlightRef.current) return
    const run = (async () => {
      try {
        await syncProactiveMessages(userId)
        await flushMarkReadQueue(markProactiveReadViaCallable)
        await queryClient.invalidateQueries({ queryKey: proactiveUnreadKeys.all })
        await queryClient.invalidateQueries({ queryKey: messageKeys.all })
      } catch (error) {
        // A stale badge beats a lying one: failure skips invalidation. The
        // transactional cursor makes the next trigger's run safe.
        console.warn('[proactiveSync] sync failed:', error)
      } finally {
        inFlightRef.current = null
      }
    })()
    inFlightRef.current = run
  }, [userId, queryClient])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') triggerSync()
    })
    return () => subscription.remove()
  }, [triggerSync])

  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      if (isProactivePushData(notification.request.content.data)) triggerSync()
    })
    return () => subscription.remove()
  }, [triggerSync])

  return { triggerSync }
}
