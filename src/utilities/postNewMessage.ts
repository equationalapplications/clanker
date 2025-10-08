import { IMessage } from 'react-native-gifted-chat'
import { sendMessage } from '../services/messageService'

interface PostNewMessageArgs {
  message: IMessage
  id: string // character ID
  userId: string // recipient user ID
}

export const postNewMessage = async ({
  message,
  id,
  userId,
}: PostNewMessageArgs): Promise<void> => {
  try {
    await sendMessage(id, userId, message)
  } catch (error) {
    console.error('Error posting new message:', error)
    throw error
  }
}
