/**
 * Character service - local-first with cloud backup
 *
 * Primary storage: Local SQLite database
 * Cloud sync: Firebase callable APIs backed by Cloud SQL
 */

import { getCurrentUser } from '~/config/firebaseConfig'
import * as characterDB from '../database/characterDatabase'
import type { CharacterInsert, CharacterUpdate } from '../database/characterDatabase'
import { logEvent } from '~/services/analyticsService'

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
  active_image_id?: string | null
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
  pending_cloud_id?: string | null
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
    const created = await characterDB.createCharacter(userId, character)
    logEvent('character_created')
    return created
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
export const searchCharacters = async (
  userId: string,
  searchText: string,
): Promise<Character[]> => {
  try {
    return await characterDB.searchCharacters(userId, searchText)
  } catch (error) {
    console.error('Error searching characters:', error)
    return []
  }
}
