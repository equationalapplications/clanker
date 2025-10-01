import { useEffect, useState } from 'react'
import { Character, LegacyCharacter, subscribeToCharacter, toLegacyCharacter } from '../services/characterService'

interface UseSupabaseCharacterArgs {
    id: string
    userId?: string
}

/**
 * Hook to get a specific character from Supabase
 */
export function useSupabaseCharacter({ id, userId }: UseSupabaseCharacterArgs): Character | null {
    const [character, setCharacter] = useState<Character | null>(null)

    useEffect(() => {
        if (id) {
            const unsubscribe = subscribeToCharacter(id, (newCharacter) => {
                setCharacter(newCharacter)
            })

            return unsubscribe
        }
    }, [id])

    return character
}

/**
 * Hook to get a specific character in legacy format for compatibility
 */
export function useSupabaseCharacterLegacy({ id, userId }: UseSupabaseCharacterArgs): LegacyCharacter | null {
    const character = useSupabaseCharacter({ id, userId })

    if (!character) {
        return null
    }

    return toLegacyCharacter(character)
}