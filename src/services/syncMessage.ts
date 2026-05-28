import { LocalMessage } from '~/database/messageDatabase'

export interface SyncMessage {
  id: string
  role: 'user' | 'model'
  text: string
  createdAt: number
}

export function toSyncMessage(
  msg: LocalMessage,
  userId: string,
): SyncMessage {
  return {
    id: msg.id,
    role: msg.sender_user_id === userId ? 'user' : 'model',
    text: msg.text,
    createdAt: msg.created_at,
  }
}
