/**
 * Character service - local-first with optional cloud sync
 * 
 * Primary storage: Local SQLite database
 * Cloud sync: Supabase (for "save character" feature - future)
 */

import * as localCharacterService from './localCharacterService'
import type { Character, CharacterInsert, CharacterUpdate } from './localCharacterService'

// Re-export types
export type { Character, CharacterInsert, CharacterUpdate }

/**
 * Get all characters for the current user
 */
export const getUserCharacters = localCharacterService.getUserCharacters

/**
 * Get a specific character by ID
 */
export const getCharacter = localCharacterService.getCharacter

/**
 * Create a new character
 */
export const createCharacter = localCharacterService.createCharacter

/**
 * Update an existing character
 */
export const updateCharacter = localCharacterService.updateCharacter

/**
 * Delete a character
 */
export const deleteCharacter = localCharacterService.deleteCharacter

/**
 * Get character count for a user
 */
export const getCharacterCount = localCharacterService.getCharacterCount

/**
 * Search characters by name
 */
export const searchCharacters = localCharacterService.searchCharacters

/**
 * Create a new character using default values
 */
export const createNewCharacter = localCharacterService.createNewCharacter

/**
 * FUTURE FEATURE: Save character to cloud
 * This will sync a local character to Supabase for sharing/backup
 */
export const saveCharacterToCloud = async (
  characterId: string,
  userId: string,
): Promise<{ cloudId: string; success: boolean }> => {
  console.log('🚧 saveCharacterToCloud: Not yet implemented')
  console.log('📋 This feature will sync local character to Supabase')
  console.log('📋 Use cases: sharing characters, backup, cross-device sync')

  // TODO: Implement cloud sync
  // 1. Get local character
  // 2. Create/update in Supabase using cloudCharacterService
  // 3. Mark as synced in local DB
  // 4. Return cloud ID

  throw new Error('Cloud sync not yet implemented')
}

/**
 * FUTURE FEATURE: Load character from cloud
 * This will import a character from Supabase to local storage
 */
export const loadCharacterFromCloud = async (
  cloudId: string,
  userId: string,
): Promise<Character | null> => {
  console.log('🚧 loadCharacterFromCloud: Not yet implemented')
  console.log('📋 This feature will import Supabase character to local storage')

  // TODO: Implement cloud import
  // 1. Fetch from Supabase using cloudCharacterService
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
  console.log('📋 This feature will browse public characters from Supabase')

  // TODO: Implement public character browsing
  // Use cloudCharacterService.getPublicCharacters()

  return []
}

/**
 * FUTURE FEATURE: Sync local character with cloud updates
 * This will pull updates from Supabase for synced characters
 */
export const syncCharacterFromCloud = async (
  characterId: string,
  userId: string,
): Promise<Character | null> => {
  console.log('🚧 syncCharacterFromCloud: Not yet implemented')
  console.log('📋 This feature will pull cloud updates for a synced character')

  // TODO: Implement cloud sync pull
  // 1. Get local character's cloud_id
  // 2. Fetch latest from Supabase
  // 3. Update local DB with changes
  // 4. Return updated character

  throw new Error('Cloud sync not yet implemented')
}
