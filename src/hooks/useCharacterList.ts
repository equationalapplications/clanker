import { useEffect, useState } from 'react'
import { Character, LegacyCharacter, subscribeToUserCharacters, toLegacyCharacter } from '../services/characterService'

/**
 * Hook to get the current user's characters from Supabase
 */
export function useCharacterList(): LegacyCharacter[] {
  const [characters, setCharacters] = useState<Character[]>([])

  useEffect(() => {
    console.log('🎣 useCharacterList - setting up subscription')
    const unsubscribe = subscribeToUserCharacters((newCharacters) => {
      console.log('🎣 useCharacterList - received characters update:', newCharacters.length, newCharacters)
      setCharacters(newCharacters)
    })

    return () => {
      console.log('🎣 useCharacterList - cleaning up subscription')
      unsubscribe()
    }
  }, [])

  const legacyCharacters = characters.map(toLegacyCharacter)
  console.log('🎣 useCharacterList - returning legacy characters:', legacyCharacters.length, legacyCharacters)

  return legacyCharacters
}
