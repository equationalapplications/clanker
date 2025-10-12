/**
 * Legacy hook for backward compatibility
 * @deprecated Use useMessages() from useMessages.ts for new code
 *
 * This hook is maintained for backward compatibility but delegates to
 * the new React Query implementation for offline support.
 */

import { IMessage } from 'react-native-gifted-chat'
import { useChatMessages as useChatMessagesQuery } from './useMessages'

interface UseChatMessagesArgs {
  id: string // character ID
  userId: string // recipient user ID
}

/**
 * Hook to get chat messages for a specific character conversation from Supabase
 * Now uses React Query for caching and offline support
 */
export function useChatMessages({ id, userId }: UseChatMessagesArgs): IMessage[] {
  return useChatMessagesQuery({ id, userId })
}
