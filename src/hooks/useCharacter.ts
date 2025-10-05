import { useEffect, useState } from 'react'
import { Character, LegacyCharacter, subscribeToCharacter, toLegacyCharacter } from '~/services/characterService'

interface UseCharacterArgs {
  id: string
  userId?: string
}

/**
 * Hook to get a specific character from Supabase
 */
export function useCharacter({ id, userId }: UseCharacterArgs): LegacyCharacter | null {
  const [character, setCharacter] = useState<Character | null>(null)

  useEffect(() => {
    if (id) {
      const unsubscribe = subscribeToCharacter(id, (newCharacter) => {
        setCharacter(newCharacter)
      })

      return unsubscribe
    }
  }, [id])

  if (!character) {
    return null
  }

  return toLegacyCharacter(character)
}
