import { updateCharacter as updateCharacterSupabase } from '../services/characterService'

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
    // Map legacy field names to Supabase schema
    const supabaseData = {
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
      Object.entries(supabaseData).filter(([_, value]) => value !== undefined)
    )

    await updateCharacterSupabase(characterId, cleanData)
  } catch (error) {
    console.error("Error updating character:", error)
    throw error
  }
}
