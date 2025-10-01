// Legacy hook that now uses Supabase
import { useSupabaseCharacterListLegacy } from "./useSupabaseCharacterList"

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

export function useCharacterList(): Character[] {
  // Use Supabase version
  return useSupabaseCharacterListLegacy()
}
