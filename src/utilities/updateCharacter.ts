import { updateCharacter as updateCharacterLocal } from '../services/characterService'
import { getCurrentUser } from '../config/firebaseConfig'

interface UpdateCharacterArgs {
  characterId: string
  name?: string
  avatar?: string
  appearance?: string
  traits?: string
  emotions?: string
  isCharacterPublic?: boolean
  context?: string
}

export default async function updateCharacter({
  characterId,
  ...data
}: UpdateCharacterArgs): Promise<void> {
  try {
    const currentUser = getCurrentUser()
    if (!currentUser) {
      throw new Error('No authenticated user')
    }

    // Map legacy field names to new schema
    const updateData = {
      name: data.name,
      avatar: data.avatar,
      appearance: data.appearance,
      traits: data.traits,
      emotions: data.emotions,
      is_public: data.isCharacterPublic,
      context: data.context,
    }

    // Remove undefined values
    const cleanData = Object.fromEntries(
      Object.entries(updateData).filter(([_, value]) => value !== undefined),
    )

    await updateCharacterLocal(characterId, currentUser.uid, cleanData)
  } catch (error) {
    console.error('Error updating character:', error)
    throw error
  }
}
