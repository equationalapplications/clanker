/**
 * Character service - local-first with cloud backup
 *
 * Primary storage: Local SQLite database
 * Cloud sync: Firebase callable APIs backed by Cloud SQL
 */

import { getCurrentUser } from '~/config/firebaseConfig'
import * as characterDB from '../database/characterDatabase'
import type { CharacterInsert, CharacterUpdate } from '../database/characterDatabase'
import { loadDefaultAvatarBase64 } from './defaultAvatarService'

export type { CharacterInsert, CharacterUpdate }

/**
 * Character type
 */
export interface Character {
  id: string
  user_id: string
  owner_user_id: string
  name: string
  avatar: string | null
  appearance: string | null
  traits: string | null
  emotions: string | null
  context: string | null
  voice?: string | null
  is_public: boolean
  created_at: string
  updated_at: string
  synced_to_cloud?: boolean
  save_to_cloud?: boolean
  cloud_id?: string | null
}

/**
 * Get all characters for the current user
 */
export const getUserCharacters = async (): Promise<Character[]> => {
  const userId = getCurrentUser()?.uid
  if (!userId) {
    console.warn('No user logged in - cannot fetch characters')
    return []
  }
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
export const createCharacter = async (character: CharacterInsert): Promise<Character | null> => {
  const userId = getCurrentUser()?.uid
  if (!userId) {
    throw new Error('User not logged in')
  }
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
 * Delete a character (soft delete — synced away from cloud on next sync)
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
 * Create a new character with default values
 */
export const createNewCharacter = async (): Promise<{ id: string }> => {
  console.log('🏗️ createNewCharacter starting...')

  const userId = getCurrentUser()?.uid
  if (!userId) {
    throw new Error('User not logged in')
  }

  try {
    console.log('📝 Creating character with default values...')

    let avatarData: string | undefined

    // Best-effort avatar load: character creation should still succeed without it.
    try {
      avatarData = (await loadDefaultAvatarBase64()) || undefined
    } catch (error) {
      console.warn('⚠️ Failed to load default avatar; creating character without avatar_data', error)
      avatarData = undefined
    }

    const character = await createCharacter({
      name: 'Clanker',
      appearance: 'A mysterious figure with an intriguing presence.',
      traits: 'Curious, intelligent, and thoughtful.',
      emotions: 'Calm and collected, with hints of excitement.',
      context: 'A helpful companion ready for meaningful conversations.',
      is_public: false,
      avatar_data: avatarData,
      voice: 'Umbriel',
    })

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

/**
 * FUTURE FEATURE: Save character to cloud
 * This will sync a local character to cloud storage for sharing/backup
 */
export const saveCharacterToCloud = async (
  characterId: string,
  userId: string,
): Promise<{ cloudId: string; success: boolean }> => {
  console.log('🚧 saveCharacterToCloud: Not yet implemented')
  console.log('📋 This feature will sync local character to Cloud SQL backend')
  console.log('📋 Use cases: sharing characters, backup, cross-device sync')

  // TODO: Implement cloud sync
  // 1. Get local character
  // 2. Create/update via callable functions backed by Cloud SQL
  // 3. Mark as synced in local DB
  // 4. Return cloud ID

  throw new Error('Cloud sync not yet implemented')
}

/**
 * FUTURE FEATURE: Load character from cloud
 * This will import a character from cloud storage to local SQLite
 */
export const loadCharacterFromCloud = async (
  cloudId: string,
  userId: string,
): Promise<Character | null> => {
  console.log('🚧 loadCharacterFromCloud: Not yet implemented')
  console.log('📋 This feature will import cloud character to local storage')

  // TODO: Implement cloud import
  // 1. Fetch from Cloud SQL via callable API
  // 2. Save to local DB with cloud_id reference
  // 3. Return local character

  throw new Error('Cloud import not yet implemented')
}

/**
 * FUTURE FEATURE: Get public characters from cloud
 * This will browse characters shared by other users
 */
export const getPublicCharacters = async (): Promise<Character[]> => {
  console.log('🚧 getPublicCharacters: Not yet implemented')
  console.log('📋 This feature will browse public characters from cloud backend')

  // TODO: Implement public character browsing
  // Use cloudCharacterService.getPublicCharacters()

  return []
}

/**
 * FUTURE FEATURE: Sync local character with cloud updates
 * This will pull updates from cloud backend for synced characters
 */
export const syncCharacterFromCloud = async (
  characterId: string,
  userId: string,
): Promise<Character | null> => {
  console.log('🚧 syncCharacterFromCloud: Not yet implemented')
  console.log('📋 This feature will pull cloud updates for a synced character')

  // TODO: Implement cloud sync pull
  // 1. Get local character's cloud_id
  // 2. Fetch latest from Cloud SQL backend
  // 3. Update local DB with changes
  // 4. Return updated character

  throw new Error('Cloud sync not yet implemented')
}
