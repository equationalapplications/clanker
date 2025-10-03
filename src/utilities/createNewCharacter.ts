import { createNewCharacter as createNewCharacterSupabase } from '../services/characterService'

/**
 * Create a new character using Supabase
 * This replaces the Firebase Cloud Function approach
 */
export const createNewCharacter = async () => {
  console.log('🏭 createNewCharacter utility called')
  try {
    console.log('📞 Calling createNewCharacterSupabase...')
    const result = await createNewCharacterSupabase()
    console.log('🎉 createNewCharacterSupabase result:', result)
    return result
  } catch (error) {
    console.error('💥 Error in createNewCharacter utility:', error)
    throw error
  }
}
