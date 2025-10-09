import { createNewCharacter as createNewCharacterLocal } from '../services/characterService'
import { auth } from '../config/firebaseConfig'

/**
 * Create a new character using local SQLite storage
 * This replaces the Firebase Cloud Function approach
 */
export const createNewCharacter = async () => {
  console.log('🏭 createNewCharacter utility called')
  try {
    const currentUser = auth.currentUser
    if (!currentUser) {
      throw new Error('No authenticated user')
    }

    console.log('📞 Calling createNewCharacterLocal...')
    const result = await createNewCharacterLocal(currentUser.uid)
    console.log('🎉 createNewCharacterLocal result:', result)
    return result
  } catch (error) {
    console.error('💥 Error in createNewCharacter utility:', error)
    throw error
  }
}
