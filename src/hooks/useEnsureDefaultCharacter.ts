import { useEffect } from 'react'
import { useAuth } from '~/auth/useAuth'
import { useCharacters, useCreateCharacter } from '~/hooks/useCharacters'

/**
 * Module-level guard to prevent multiple screens from racing to create
 * the default character simultaneously.
 */
let creationInFlight = false

/**
 * Ensures the user always has at least one character.
 * If the character list is empty, auto-creates a default character.
 *
 * Safe to call from multiple screens — a module-level flag prevents
 * duplicate creation even when React Query hasn't settled yet.
 */
export function useEnsureDefaultCharacter() {
    const { user } = useAuth()
    const { characters, isLoading } = useCharacters()
    const createCharacterMutation = useCreateCharacter()

    useEffect(() => {
        if (
            !isLoading &&
            user &&
            characters !== undefined &&
            characters.length === 0 &&
            !creationInFlight &&
            !createCharacterMutation.isPending
        ) {
            creationInFlight = true
            createCharacterMutation.mutate(
                {
                    name: 'New Character',
                    appearance: 'A mysterious figure with an intriguing presence.',
                    traits: 'Curious, intelligent, and thoughtful.',
                    emotions: 'Calm and collected, with hints of excitement.',
                    context: 'A helpful companion ready for meaningful conversations.',
                    is_public: false,
                },
                {
                    onSettled: () => {
                        creationInFlight = false
                    },
                },
            )
        }
    }, [isLoading, user, characters, createCharacterMutation, createCharacterMutation.isPending])

    return {
        isCreatingDefault: createCharacterMutation.isPending || creationInFlight,
    }
}
