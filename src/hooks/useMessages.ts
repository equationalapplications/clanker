/**
 * React Query hooks for message management with offline support
 *
 * Features:
 * - Automatic caching and background updates
 * - Optimistic updates for sending messages
 * - Real-time subscriptions via query invalidation
 * - Offline message queuing
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { IMessage } from 'react-native-gifted-chat'
import { useAuth } from '~/auth/useAuth'
import { getMessages, sendMessage, deleteMessage, updateMessage } from '~/services/messageService'
import { supabaseClient } from '~/config/supabaseClient'

/**
 * Query key factory for messages
 */
export const messageKeys = {
  all: ['messages'] as const,
  lists: () => [...messageKeys.all, 'list'] as const,
  list: (characterId: string, recipientUserId: string) =>
    [...messageKeys.lists(), characterId, recipientUserId] as const,
}

/**
 * Hook to get chat messages for a character conversation
 */
export function useMessages(characterId: string | undefined, recipientUserId: string | undefined) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: messageKeys.list(characterId || '', recipientUserId || ''),
    queryFn: () => getMessages(characterId || '', recipientUserId || ''),
    enabled: !!characterId && !!recipientUserId && !!user,
    staleTime: 1000 * 30, // 30 seconds - messages change frequently
  })

  // Set up real-time subscription
  useEffect(() => {
    if (!characterId || !recipientUserId || !user?.uid) return

    const channel = supabaseClient
      .channel(`messages-${characterId}-${recipientUserId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'yours_brightly_messages',
          filter: `character_id=eq.${characterId}`,
        },
        (payload) => {
          console.log('📡 Real-time message change:', payload.eventType)

          // Check if this message is part of our conversation
          const message = payload.new as any
          if (
            (message?.sender_user_id === user.uid &&
              message?.recipient_user_id === recipientUserId) ||
            (message?.sender_user_id === recipientUserId && message?.recipient_user_id === user.uid)
          ) {
            queryClient.invalidateQueries({
              queryKey: messageKeys.list(characterId, recipientUserId),
            })
          }
        },
      )
      .subscribe()

    return () => {
      supabaseClient.removeChannel(channel)
    }
  }, [characterId, recipientUserId, user?.uid, queryClient])

  return {
    ...query,
    messages: query.data || [],
  }
}

/**
 * Mutation hook to send a message with optimistic update
 */
export function useSendMessage(characterId: string, recipientUserId: string) {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: (message: Pick<IMessage, '_id' | 'text' | 'user'> & { [key: string]: any }) =>
      sendMessage(characterId, recipientUserId, message),

    // Optimistic update: add message immediately to UI
    onMutate: async (newMessage) => {
      await queryClient.cancelQueries({
        queryKey: messageKeys.list(characterId, recipientUserId),
      })

      const previousMessages = queryClient.getQueryData<IMessage[]>(
        messageKeys.list(characterId, recipientUserId),
      )

      // Create optimistic message with pending status
      const optimisticMessage: IMessage = {
        ...newMessage,
        _id: newMessage._id,
        text: newMessage.text,
        createdAt: new Date(),
        user: newMessage.user,
        pending: true, // Mark as pending
      }

      // Add to cache (messages are in reverse chronological order)
      queryClient.setQueryData<IMessage[]>(
        messageKeys.list(characterId, recipientUserId),
        (old) => [optimisticMessage, ...(old || [])],
      )

      return { previousMessages, optimisticMessage }
    },

    onSuccess: (data, variables, context) => {
      console.log('✅ Message sent successfully:', variables._id)

      // Remove pending flag from the optimistic message
      queryClient.setQueryData<IMessage[]>(
        messageKeys.list(characterId, recipientUserId),
        (old) => {
          if (!old) return old
          return old.map((msg) =>
            msg._id === context?.optimisticMessage._id
              ? { ...msg, pending: false, sent: true }
              : msg,
          )
        },
      )

      // Refetch to get server timestamp and any AI responses
      queryClient.invalidateQueries({
        queryKey: messageKeys.list(characterId, recipientUserId),
      })
    },

    onError: (error, variables, context) => {
      console.error('❌ Failed to send message:', error)

      // Mark message as failed instead of removing it
      queryClient.setQueryData<IMessage[]>(
        messageKeys.list(characterId, recipientUserId),
        (old) => {
          if (!old) return old
          return old.map((msg) =>
            msg._id === context?.optimisticMessage._id
              ? { ...msg, pending: false, sent: false, error: true }
              : msg,
          )
        },
      )

      // Could implement retry logic here
    },
  })
}

/**
 * Mutation hook to delete a message with optimistic update
 */
export function useDeleteMessage(characterId: string, recipientUserId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (messageId: string) => deleteMessage(messageId),

    // Optimistic update: remove message immediately
    onMutate: async (messageId) => {
      await queryClient.cancelQueries({
        queryKey: messageKeys.list(characterId, recipientUserId),
      })

      const previousMessages = queryClient.getQueryData<IMessage[]>(
        messageKeys.list(characterId, recipientUserId),
      )

      // Optimistically remove the message
      queryClient.setQueryData<IMessage[]>(
        messageKeys.list(characterId, recipientUserId),
        (old) => old?.filter((msg) => msg._id !== messageId) || [],
      )

      return { previousMessages, messageId }
    },

    onSuccess: (data, messageId) => {
      console.log('✅ Message deleted successfully:', messageId)
    },

    onError: (error, messageId, context) => {
      console.error('❌ Failed to delete message:', error)

      // Rollback optimistic update
      if (context?.previousMessages) {
        queryClient.setQueryData(
          messageKeys.list(characterId, recipientUserId),
          context.previousMessages,
        )
      }
    },
  })
}

/**
 * Mutation hook to update a message with optimistic update
 */
export function useUpdateMessage(characterId: string, recipientUserId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      messageId,
      updates,
    }: {
      messageId: string
      updates: { text?: string; message_data?: Record<string, any> }
    }) => updateMessage(messageId, updates),

    // Optimistic update: apply changes immediately
    onMutate: async ({ messageId, updates }) => {
      await queryClient.cancelQueries({
        queryKey: messageKeys.list(characterId, recipientUserId),
      })

      const previousMessages = queryClient.getQueryData<IMessage[]>(
        messageKeys.list(characterId, recipientUserId),
      )

      // Optimistically update the message
      queryClient.setQueryData<IMessage[]>(
        messageKeys.list(characterId, recipientUserId),
        (old) => {
          if (!old) return old
          return old.map((msg) =>
            msg._id === messageId ? { ...msg, ...updates, edited: true } : msg,
          )
        },
      )

      return { previousMessages, messageId }
    },

    onSuccess: (data, variables) => {
      console.log('✅ Message updated successfully:', variables.messageId)

      // Refetch to get server data
      queryClient.invalidateQueries({
        queryKey: messageKeys.list(characterId, recipientUserId),
      })
    },

    onError: (error, variables, context) => {
      console.error('❌ Failed to update message:', error)

      // Rollback optimistic update
      if (context?.previousMessages) {
        queryClient.setQueryData(
          messageKeys.list(characterId, recipientUserId),
          context.previousMessages,
        )
      }
    },
  })
}

/**
 * Legacy hook for backward compatibility
 * Use useMessages() for new code
 */
export function useChatMessages({ id, userId }: { id: string; userId: string }): IMessage[] {
  const { messages } = useMessages(id, userId)
  return messages
}
