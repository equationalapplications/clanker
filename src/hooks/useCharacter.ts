// Legacy hook that now uses Supabase
import { useSupabaseCharacterLegacy } from "./useSupabaseCharacter"

interface UseCharacterArgs {
  id: string
  userId: string
}

interface Character {
  id: string
  name: string
  avatar: string
  appearance: string
  traits: string
  emotions: string
  isCharacterPublic: boolean
  context: string
}

export function useCharacter({ id, userId }: UseCharacterArgs) {
  // Use Supabase version
  return useSupabaseCharacterLegacy({ id, userId })
}
