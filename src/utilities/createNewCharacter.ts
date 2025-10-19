import { createNewCharacter as createNewCharacterLocal } from '../services/characterService'

/**
 * Create a new character using local SQLite storage
 * This replaces the Firebase Cloud Function approach
 */
export const createNewCharacter = async (userId: string) => {
  console.log('🏭 createNewCharacter utility called')
  try {
    if (!userId) {
      throw new Error('No authenticated user')
    }

    console.log('📞 Calling createNewCharacterLocal...')
    const result = await createNewCharacterLocal(userId)
    console.log('🎉 createNewCharacterLocal result:', result)
    return result
  } catch (error) {
    console.error('💥 Error in createNewCharacter utility:', error)
    throw error
  }
}
