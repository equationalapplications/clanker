import { createNewCharacter as createNewCharacterSupabase } from '../services/characterService'

/**
 * Create a new character using Supabase
 * This replaces the Firebase Cloud Function approach
 */
export const createNewCharacter = async () => {
  const result = await createNewCharacterSupabase()
  return result
}
