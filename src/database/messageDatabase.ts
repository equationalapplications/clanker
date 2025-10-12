/**
 * Local SQLite message database service
 * Replaces Supabase cloud storage with local-first architecture
 */

import { IMessage } from 'react-native-gifted-chat'
import { getDatabase } from './index'

export interface LocalMessage {
    id: string
    character_id: string
    sender_user_id: string
    recipient_user_id: string | null
    text: string
    created_at: number
    message_data: string // JSON stringified IMessage data
    pending: number // 0 or 1 (SQLite boolean)
    sent: number // 0 or 1
    error: number // 0 or 1
    edited: number // 0 or 1
}

/**
 * Convert LocalMessage to IMessage format for GiftedChat
 */
function toGiftedChatMessage(msg: LocalMessage, currentUserId: string): IMessage {
    const isUserMessage = msg.sender_user_id === currentUserId

    return {
        _id: msg.id,
        text: msg.text,
        createdAt: new Date(msg.created_at),
        user: {
            _id: isUserMessage ? msg.sender_user_id : msg.recipient_user_id || msg.character_id,
            name: isUserMessage ? 'You' : 'Character',
        },
        pending: msg.pending === 1,
        sent: msg.sent === 1,
        received: !isUserMessage && msg.sent === 1,
        // Restore any additional data from message_data
        ...(msg.message_data ? JSON.parse(msg.message_data) : {}),
    }
}

/**
 * Get all messages for a character conversation
 */
export async function getMessages(
    characterId: string,
    userId: string,
    limit: number = 50,
    offset: number = 0,
): Promise<IMessage[]> {
    const db = await getDatabase()

    const messages = await db.getAllAsync<LocalMessage>(
        `SELECT * FROM messages 
     WHERE character_id = ? 
     AND (sender_user_id = ? OR recipient_user_id = ?)
     ORDER BY created_at DESC 
     LIMIT ? OFFSET ?`,
        [characterId, userId, userId, limit, offset],
    )

    return messages.map((msg) => toGiftedChatMessage(msg, userId))
}

/**
 * Get a single message by ID
 */
export async function getMessage(messageId: string, userId: string): Promise<IMessage | null> {
    const db = await getDatabase()

    const message = await db.getFirstAsync<LocalMessage>(
        'SELECT * FROM messages WHERE id = ? AND (sender_user_id = ? OR recipient_user_id = ?)',
        [messageId, userId, userId],
    )

    return message ? toGiftedChatMessage(message, userId) : null
}

/**
 * Send a new message (save to local database)
 */
export async function sendMessage(
    characterId: string,
    userId: string,
    text: string,
    messageId?: string,
    additionalData?: Partial<IMessage>,
): Promise<IMessage> {
    const db = await getDatabase()

    const id = messageId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const createdAt = Date.now()
    const messageData = additionalData ? JSON.stringify(additionalData) : '{}'

    await db.runAsync(
        `INSERT INTO messages 
     (id, character_id, sender_user_id, recipient_user_id, text, created_at, message_data, pending, sent, error, edited)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, characterId, userId, characterId, text, createdAt, messageData, 0, 1, 0, 0],
    )

    return {
        _id: id,
        text,
        createdAt: new Date(createdAt),
        user: {
            _id: userId,
            name: 'You',
        },
        sent: true,
        pending: false,
        ...additionalData,
    }
}

/**
 * Save an AI response message
 */
export async function saveAIMessage(
    characterId: string,
    userId: string,
    text: string,
    messageId?: string,
    additionalData?: Partial<IMessage>,
): Promise<IMessage> {
    const db = await getDatabase()

    const id = messageId || `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const createdAt = Date.now()
    const messageData = additionalData ? JSON.stringify(additionalData) : '{}'

    await db.runAsync(
        `INSERT INTO messages 
     (id, character_id, sender_user_id, recipient_user_id, text, created_at, message_data, pending, sent, error, edited)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, characterId, characterId, userId, text, createdAt, messageData, 0, 1, 0, 0],
    )

    return {
        _id: id,
        text,
        createdAt: new Date(createdAt),
        user: {
            _id: characterId,
            name: 'Character',
        },
        sent: true,
        pending: false,
        ...additionalData,
    }
}

/**
 * Update message status (pending, sent, error)
 */
export async function updateMessageStatus(
    messageId: string,
    status: {
        pending?: boolean
        sent?: boolean
        error?: boolean
    },
): Promise<void> {
    const db = await getDatabase()

    const updates: string[] = []
    const values: (number | string)[] = []

    if (status.pending !== undefined) {
        updates.push('pending = ?')
        values.push(status.pending ? 1 : 0)
    }
    if (status.sent !== undefined) {
        updates.push('sent = ?')
        values.push(status.sent ? 1 : 0)
    }
    if (status.error !== undefined) {
        updates.push('error = ?')
        values.push(status.error ? 1 : 0)
    }

    if (updates.length === 0) return

    values.push(messageId)

    await db.runAsync(`UPDATE messages SET ${updates.join(', ')} WHERE id = ?`, values)
}

/**
 * Update message text (for edits)
 */
export async function updateMessageText(messageId: string, text: string): Promise<void> {
    const db = await getDatabase()

    await db.runAsync('UPDATE messages SET text = ?, edited = 1 WHERE id = ?', [text, messageId])
}

/**
 * Delete a message
 */
export async function deleteMessage(messageId: string): Promise<void> {
    const db = await getDatabase()

    await db.runAsync('DELETE FROM messages WHERE id = ?', [messageId])
}

/**
 * Delete all messages for a character
 */
export async function deleteCharacterMessages(characterId: string): Promise<void> {
    const db = await getDatabase()

    await db.runAsync('DELETE FROM messages WHERE character_id = ?', [characterId])
}

/**
 * Get message count for a character
 */
export async function getMessageCount(characterId: string, userId: string): Promise<number> {
    const db = await getDatabase()

    const result = await db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM messages 
     WHERE character_id = ? 
     AND (sender_user_id = ? OR recipient_user_id = ?)`,
        [characterId, userId, userId],
    )

    return result?.count || 0
}

/**
 * Get last message for a character (for preview)
 */
export async function getLastMessage(
    characterId: string,
    userId: string,
): Promise<IMessage | null> {
    const db = await getDatabase()

    const message = await db.getFirstAsync<LocalMessage>(
        `SELECT * FROM messages 
     WHERE character_id = ? 
     AND (sender_user_id = ? OR recipient_user_id = ?)
     ORDER BY created_at DESC 
     LIMIT 1`,
        [characterId, userId, userId],
    )

    return message ? toGiftedChatMessage(message, userId) : null
}

/**
 * Search messages by text
 */
export async function searchMessages(
    characterId: string,
    userId: string,
    searchText: string,
): Promise<IMessage[]> {
    const db = await getDatabase()

    const messages = await db.getAllAsync<LocalMessage>(
        `SELECT * FROM messages 
     WHERE character_id = ? 
     AND (sender_user_id = ? OR recipient_user_id = ?)
     AND text LIKE ?
     ORDER BY created_at DESC 
     LIMIT 50`,
        [characterId, userId, userId, `%${searchText}%`],
    )

    return messages.map((msg) => toGiftedChatMessage(msg, userId))
}

/**
 * Batch insert messages (for initial sync or imports)
 */
export async function batchInsertMessages(messages: LocalMessage[]): Promise<void> {
    const db = await getDatabase()

    await db.withTransactionAsync(async () => {
        for (const msg of messages) {
            await db.runAsync(
                `INSERT OR REPLACE INTO messages 
         (id, character_id, sender_user_id, recipient_user_id, text, created_at, message_data, pending, sent, error, edited)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    msg.id,
                    msg.character_id,
                    msg.sender_user_id,
                    msg.recipient_user_id,
                    msg.text,
                    msg.created_at,
                    msg.message_data,
                    msg.pending,
                    msg.sent,
                    msg.error,
                    msg.edited,
                ],
            )
        }
    })
}
