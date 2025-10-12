/**
 * Local character service - primary interface for character management
 * Uses local SQLite storage with optional cloud sync
 */

import * as characterDB from '../database/characterDatabase'
import type { CharacterInsert, CharacterUpdate } from '../database/characterDatabase'

export type { CharacterInsert, CharacterUpdate }

/**
 * Character type (matches Supabase structure for compatibility)
 */
export interface Character {
    id: string
    user_id: string
    name: string
    avatar: string | null
    appearance: string | null
    traits: string | null
    emotions: string | null
    context: string | null
    is_public: boolean
    created_at: string
    updated_at: string
    synced_to_cloud?: boolean
    cloud_id?: string | null
}

/**
 * Get all characters for the current user
 */
export const getUserCharacters = async (userId: string): Promise<Character[]> => {
    try {
        return await characterDB.getUserCharacters(userId)
    } catch (error) {
        console.error('Error fetching user characters:', error)
        return []
    }
}

/**
 * Get a specific character by ID
 */
export const getCharacter = async (id: string, userId: string): Promise<Character | null> => {
    try {
        return await characterDB.getCharacter(id, userId)
    } catch (error) {
        console.error('Error fetching character:', error)
        return null
    }
}

/**
 * Create a new character
 */
export const createCharacter = async (
    userId: string,
    character: CharacterInsert,
): Promise<Character | null> => {
    try {
        return await characterDB.createCharacter(userId, character)
    } catch (error) {
        console.error('Error creating character:', error)
        throw error
    }
}

/**
 * Update an existing character
 */
export const updateCharacter = async (
    id: string,
    userId: string,
    updates: CharacterUpdate,
): Promise<Character | null> => {
    try {
        return await characterDB.updateCharacter(id, userId, updates)
    } catch (error) {
        console.error('Error updating character:', error)
        throw error
    }
}

/**
 * Delete a character
 */
export const deleteCharacter = async (id: string, userId: string): Promise<void> => {
    try {
        await characterDB.deleteCharacter(id, userId)
    } catch (error) {
        console.error('Error deleting character:', error)
        throw error
    }
}

/**
 * Get character count for a user
 */
export const getCharacterCount = async (userId: string): Promise<number> => {
    try {
        return await characterDB.getCharacterCount(userId)
    } catch (error) {
        console.error('Error getting character count:', error)
        return 0
    }
}

/**
 * Search characters by name
 */
export const searchCharacters = async (userId: string, searchText: string): Promise<Character[]> => {
    try {
        return await characterDB.searchCharacters(userId, searchText)
    } catch (error) {
        console.error('Error searching characters:', error)
        return []
    }
}

/**
 * Create a new character using default values
 * (Maintains compatibility with existing createNewCharacter utility)
 */
export const createNewCharacter = async (userId: string): Promise<{ id: string }> => {
    console.log('🏗️ createNewCharacter (Local) starting...')
    try {
        console.log('📝 Creating character with default values...')
        const character = await createCharacter(userId, {
            name: 'New Character',
            appearance: 'A mysterious figure with an intriguing presence.',
            traits: 'Curious, intelligent, and thoughtful.',
            emotions: 'Calm and collected, with hints of excitement.',
            context: 'A helpful companion ready for meaningful conversations.',
            is_public: false,
        })

        console.log('🔍 Character creation result:', character)

        if (!character) {
            console.error('❌ Character creation returned null')
            throw new Error('Failed to create character')
        }

        const result = { id: character.id }
        console.log('✨ Returning character ID:', result)
        return result
    } catch (error) {
        console.error('💥 Error in createNewCharacter:', error)
        throw error
    }
}
