import { useQuery } from '@tanstack/react-query'
import { countUnreadProactive } from '~/database/messageDatabase'

/**
 * Query key factory for proactive-unread lookups. Stable per characterId so
 * the mark-read queue (Task 11) and any future manual invalidation target
 * exactly the same cache slot.
 */
export const proactiveUnreadKeys = {
  all: ['proactiveUnread'] as const,
  detail: (characterId: string) => [...proactiveUnreadKeys.all, characterId] as const,
}

/**
 * Boolean badge for the character list — true while this character has at
 * least one proactive message that is unread AND still inside the staleness
 * escape window.
 *
 * Deliberately a boolean, not a count: AI chats are not an inbox, and a
 * numeric badge reads as "backlog to clear". The character list dot signals
 * "there's something new in this chat" — same UX as the unread dot in chat
 * apps — without nudging the user toward clearing a queue.
 *
 * `countUnreadProactive` already applies the `UNREAD_STALENESS_ESCAPE_MS`
 * guardrail (mirrored from `functions/src/proactiveWakeupGuardrails.ts`), so
 * the client and the server's push-decision agree about which messages still
 * count.
 */
export function useProactiveUnread(characterId: string): { hasUnread: boolean } {
  const query = useQuery({
    queryKey: proactiveUnreadKeys.detail(characterId),
    queryFn: () => countUnreadProactive(characterId, Date.now()),
    enabled: !!characterId,
    // Cheap local SQLite count — keep fresh enough that opening a chat and
    // coming back drops the dot, but don't slam the DB on every keystroke.
    staleTime: 1000 * 10,
    refetchInterval: 1000 * 30,
    networkMode: 'offlineFirst',
  })

  return { hasUnread: (query.data ?? 0) > 0 }
}
