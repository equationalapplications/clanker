/**
 * Local SQLite message service
 * Replaced Supabase cloud storage with local-first architecture
 */

import { IMessage } from 'react-native-gifted-chat'
import * as messageDB from '../database/messageDatabase'

/**
 * Get messages for a specific character conversation
 */
export const getMessages = async (
  characterId: string,
  userId: string,
): Promise<IMessage[]> => {
  try {
    return await messageDB.getMessages(characterId, userId)
  } catch (error) {
    console.error('Error fetching messages:', error)
    return []
  }
}

/**
 * Send a new message (save to local database)
 */
export const sendMessage = async (
  characterId: string,
  userId: string,
  message: Pick<IMessage, '_id' | 'text' | 'user'> & { [key: string]: any },
): Promise<void> => {
  try {
    // Extract IMessage properties
    const { _id, text, user: messageUser, ...additionalData } = message

    await messageDB.sendMessage(characterId, userId, text, String(_id), additionalData)
  } catch (error) {
    console.error('Error sending message:', error)
    throw error
  }
}

/**
 * Delete a message
 */
export const deleteMessage = async (messageId: string): Promise<void> => {
  try {
    await messageDB.deleteMessage(messageId)
  } catch (error) {
    console.error('Error deleting message:', error)
    throw error
  }
}

/**
 * Update a message
 */
export const updateMessage = async (
  messageId: string,
  updates: { text?: string; message_data?: Record<string, any> },
): Promise<void> => {
  try {
    if (updates.text) {
      await messageDB.updateMessageText(messageId, updates.text)
    }
    // message_data updates would need to be handled differently in SQLite
    // For now, we only support text updates
  } catch (error) {
    console.error('Error updating message:', error)
    throw error
  }
}

/**
 * Get message count for a character
 */
export const getMessageCount = async (characterId: string, userId: string): Promise<number> => {
  try {
    return await messageDB.getMessageCount(characterId, userId)
  } catch (error) {
    console.error('Error getting message count:', error)
    return 0
  }
}

/**
 * Get last message for a character (for preview)
 */
export const getLastMessage = async (
  characterId: string,
  userId: string,
): Promise<IMessage | null> => {
  try {
    return await messageDB.getLastMessage(characterId, userId)
  } catch (error) {
    console.error('Error getting last message:', error)
    return null
  }
}

/**
 * Search messages by text
 */
export const searchMessages = async (
  characterId: string,
  userId: string,
  searchText: string,
): Promise<IMessage[]> => {
  try {
    return await messageDB.searchMessages(characterId, userId, searchText)
  } catch (error) {
    console.error('Error searching messages:', error)
    return []
  }
}

/**
 * Delete all messages for a character
 */
export const deleteCharacterMessages = async (characterId: string): Promise<void> => {
  try {
    await messageDB.deleteCharacterMessages(characterId)
  } catch (error) {
    console.error('Error deleting character messages:', error)
    throw error
  }
}
