import { useEffect, useState } from 'react'
import { Character, LegacyCharacter, subscribeToUserCharacters, toLegacyCharacter } from '../services/characterService'

/**
 * Hook to get the current user's characters from Supabase
 */
export function useCharacterList(): LegacyCharacter[] {
  const [characters, setCharacters] = useState<Character[]>([])

  useEffect(() => {
    const unsubscribe = subscribeToUserCharacters((newCharacters) => {
      setCharacters(newCharacters)
    })

    return unsubscribe
  }, [])

  return characters.map(toLegacyCharacter)
}
