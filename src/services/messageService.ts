import { supabase, Database } from '../config/supabaseConfig'
import { IMessage } from 'react-native-gifted-chat'

// Types for message data
export type Message = Database['public']['Tables']['messages']['Row']
export type MessageInsert = Database['public']['Tables']['messages']['Insert']
export type GiftedChatMessage = Database['public']['Views']['messages_gifted_chat']['Row']

/**
 * Get messages for a specific character conversation
 */
export const getMessages = async (
    characterId: string,
    recipientUserId: string
): Promise<IMessage[]> => {
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        return []
    }

    const { data, error } = await supabase
        .from('messages_gifted_chat')
        .select('*')
        .eq('character_id', characterId)
        .or(`and(sender_user_id.eq.${user.id},recipient_user_id.eq.${recipientUserId}),and(sender_user_id.eq.${recipientUserId},recipient_user_id.eq.${user.id})`)
        .order('createdAt', { ascending: false })

    if (error) {
        console.error('Error fetching messages:', error)
        return []
    }

    // Convert to IMessage format
    return (data || []).map(msg => ({
        _id: msg._id,
        text: msg.text,
        createdAt: new Date(msg.createdAt),
        user: {
            _id: msg.user._id,
            name: msg.user.name || 'Anonymous',
            avatar: msg.user.avatar || undefined,
        },
        ...msg.message_data, // Spread any additional IMessage properties
    }))
}

/**
 * Send a new message
 */
export const sendMessage = async (
    characterId: string,
    recipientUserId: string,
    message: Pick<IMessage, '_id' | 'text' | 'user'> & { [key: string]: any }
): Promise<void> => {
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        throw new Error('No authenticated user')
    }

    // Extract IMessage properties
    const { _id, text, user: messageUser, ...additionalData } = message

    const { error } = await supabase.rpc('insert_message', {
        p_character_id: characterId,
        p_recipient_user_id: recipientUserId,
        p_message_id: String(_id),
        p_text: text,
        p_message_data: additionalData,
    })

    if (error) {
        console.error('Error sending message:', error)
        throw error
    }
}

/**
 * Delete a message
 */
export const deleteMessage = async (messageId: string): Promise<void> => {
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        throw new Error('No authenticated user')
    }

    const { error } = await supabase
        .from('messages')
        .delete()
        .eq('message_id', messageId)
        .eq('sender_user_id', user.id) // Only allow deleting own messages

    if (error) {
        console.error('Error deleting message:', error)
        throw error
    }
}

/**
 * Update a message
 */
export const updateMessage = async (
    messageId: string,
    updates: { text?: string; message_data?: Record<string, any> }
): Promise<void> => {
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        throw new Error('No authenticated user')
    }

    const { error } = await supabase
        .from('messages')
        .update(updates)
        .eq('message_id', messageId)
        .eq('sender_user_id', user.id) // Only allow updating own messages

    if (error) {
        console.error('Error updating message:', error)
        throw error
    }
}

/**
 * Get conversation history for a user
 */
export const getConversationHistory = async (): Promise<Array<{
    characterId: string
    characterName: string
    lastMessage: string
    lastMessageTime: Date
    recipientUserId: string
    recipientName: string
}>> => {
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        return []
    }

    // This would be a complex query - for now return empty array
    // In practice, you might want to create a view or function for this
    return []
}

/**
 * Subscribe to messages for a specific character conversation
 */
export const subscribeToMessages = (
    characterId: string,
    recipientUserId: string,
    callback: (messages: IMessage[]) => void
) => {
    let currentUserId: string | null = null

    // Set up auth state listener
    const authSubscription = supabase.auth.onAuthStateChange(async (event, session) => {
        if (session?.user) {
            currentUserId = session.user.id

            // Get initial messages
            const messages = await getMessages(characterId, recipientUserId)
            callback(messages)
        } else {
            currentUserId = null
            callback([])
        }
    })

    // Set up real-time subscription for new messages
    const messagesSubscription = supabase
        .channel(`messages-${characterId}-${recipientUserId}`)
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'messages',
                filter: `character_id=eq.${characterId}`,
            },
            async (payload) => {
                // Check if this message is part of our conversation
                const message = payload.new as Message
                if (
                    currentUserId &&
                    ((message.sender_user_id === currentUserId && message.recipient_user_id === recipientUserId) ||
                        (message.sender_user_id === recipientUserId && message.recipient_user_id === currentUserId))
                ) {
                    // Refetch all messages to maintain proper order
                    const messages = await getMessages(characterId, recipientUserId)
                    callback(messages)
                }
            }
        )
        .subscribe()

    // Return cleanup function
    return () => {
        authSubscription.data.subscription?.unsubscribe()
        messagesSubscription.unsubscribe()
    }
}

/**
 * Clean up old messages (user can clean their own messages)
 */
export const cleanupOldMessages = async (daysOld: number): Promise<number> => {
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        throw new Error('No authenticated user')
    }

    const { data, error } = await supabase.rpc('cleanup_user_messages_older_than_days', {
        days_old: daysOld,
    })

    if (error) {
        console.error('Error cleaning up messages:', error)
        throw error
    }

    return data || 0
}

/**
 * Get message statistics for the current user
 */
export const getMessageStats = async (): Promise<{
    totalMessages: number
    oldestMessage: Date | null
    newestMessage: Date | null
    messagesLast30Days: number
    messagesLast90Days: number
    avgMessagesPerDay: number
}> => {
    const { data, error } = await supabase.rpc('get_message_stats')

    if (error) {
        console.error('Error getting message stats:', error)
        throw error
    }

    return {
        totalMessages: data?.total_messages || 0,
        oldestMessage: data?.oldest_message ? new Date(data.oldest_message) : null,
        newestMessage: data?.newest_message ? new Date(data.newest_message) : null,
        messagesLast30Days: data?.messages_last_30_days || 0,
        messagesLast90Days: data?.messages_last_90_days || 0,
        avgMessagesPerDay: parseFloat(data?.avg_messages_per_day || '0'),
    }
}