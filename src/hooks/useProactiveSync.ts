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
 * Decision 3: sync on mount, on foreground, and on foreground receipt, one
 * in-flight run, invalidate the badge + the touched thread caches on
 * completion. Task 7's routing hook reuses triggerSync for notification taps.
 *
 * `triggerSync` returns the in-flight run as a Promise so a tap handler can
 * await the sync (marking the opened thread read AFTER the new messages land,
 * not just on first focus, where the initial countUnreadProactive returned 0
 * because the message had not arrived yet).
 */
export function useProactiveSync(userId: string | null | undefined): { triggerSync: () => Promise<void> | void } {
  const queryClient = useQueryClient()
  const inFlightRef = useRef<Promise<void> | null>(null)

  const triggerSync = useCallback((): Promise<void> | void => {
    if (!userId) return
    if (inFlightRef.current) return inFlightRef.current
    const run = (async () => {
      try {
        // `null` means the pull failed — distinct from `[]` (pull succeeded,
        // nothing new). Only the failure case skips invalidation.
        let touchedCharacterIds: string[] | null = null
        try {
          touchedCharacterIds = await syncProactiveMessages(userId)
        } catch (error) {
          // A stale badge beats a lying one: failure skips invalidation. The
          // transactional cursor makes the next trigger's run safe.
          console.warn('[proactiveSync] sync failed:', error)
        }

        // The durable mark-read queue is independent of the pull. A dropped
        // receipt is severe — the server then suppresses every future push
        // from that character — so the flush lives outside the pull's try and
        // always gets its attempt, even when the pull just threw.
        try {
          await flushMarkReadQueue(markProactiveReadViaCallable)
        } catch (error) {
          console.warn('[proactiveSync] mark-read flush failed:', error)
        }

        if (touchedCharacterIds === null) return
        await queryClient.invalidateQueries({ queryKey: proactiveUnreadKeys.all })
        // Only the threads this run actually wrote to. `messageKeys.all` is the
        // prefix of every list key, so invalidating it refetched every cached
        // conversation on every sync.
        await Promise.all(
          touchedCharacterIds.map((characterId) =>
            queryClient.invalidateQueries({ queryKey: messageKeys.character(characterId) }),
          ),
        )
      } catch (error) {
        console.warn('[proactiveSync] sync run failed:', error)
      } finally {
        inFlightRef.current = null
      }
    })()
    inFlightRef.current = run
    return run
  }, [userId, queryClient])

  // Cold start. An app that launches straight into the foreground emits no
  // AppState 'change' and — absent a tap — no receipt, so without this the
  // first sync would wait for a background/foreground round trip.
  useEffect(() => {
    if (!userId) return
    triggerSync()
  }, [userId, triggerSync])

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
