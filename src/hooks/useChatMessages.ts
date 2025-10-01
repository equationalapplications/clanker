// Legacy hook that now uses Supabase
import { IMessage } from "react-native-gifted-chat"
import { useSupabaseChatMessages } from "./useSupabaseChatMessages"

interface UseChatMessagesArgs {
  id: string
  userId: string
}

export function useChatMessages({ id, userId }: UseChatMessagesArgs): IMessage[] {
  // Use Supabase version
  return useSupabaseChatMessages({ id, userId })
}
