import { useEffect, useState } from 'react'
import { Character, LegacyCharacter, subscribeToUserCharacters, toLegacyCharacter } from '../services/characterService'

/**
 * Hook to get the current user's characters from Supabase
 */
export function useSupabaseCharacterList(): Character[] {
    const [characters, setCharacters] = useState<Character[]>([])

    useEffect(() => {
        const unsubscribe = subscribeToUserCharacters((newCharacters) => {
            setCharacters(newCharacters)
        })

        return unsubscribe
    }, [])

    return characters
}

/**
 * Hook to get user characters in legacy format for compatibility
 */
export function useSupabaseCharacterListLegacy(): LegacyCharacter[] {
    const characters = useSupabaseCharacterList()

    return characters.map(toLegacyCharacter)
}