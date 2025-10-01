import { useEffect, useState } from 'react'
import { IMessage } from 'react-native-gifted-chat'
import { subscribeToMessages } from '../services/messageService'

interface UseSupabaseChatMessagesArgs {
    id: string      // character ID
    userId: string  // recipient user ID
}

/**
 * Hook to get chat messages for a specific character conversation from Supabase
 */
export function useSupabaseChatMessages({ id, userId }: UseSupabaseChatMessagesArgs): IMessage[] {
    const [messages, setMessages] = useState<IMessage[]>([])

    useEffect(() => {
        if (id && userId) {
            const unsubscribe = subscribeToMessages(id, userId, (newMessages) => {
                setMessages(newMessages)
            })

            return unsubscribe
        } else {
            setMessages([])
        }
    }, [id, userId])

    return messages
}