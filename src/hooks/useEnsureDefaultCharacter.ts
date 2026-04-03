import { useEffect, useRef } from 'react'
import { useIsMutating } from '@tanstack/react-query'
import { useSelector } from '@xstate/react'
import { useAuthMachine } from '~/hooks/useMachines'
import { useCharacters, useCreateCharacter, createCharacterMutationKey } from '~/hooks/useCharacters'

/**
 * Module-level mutex to prevent multiple screens from racing to create
 * the default character simultaneously. Used only as a last-resort guard,
 * not as UI state — reactive pending state comes from useIsMutating.
 */
let creationInFlight = false
let creationFailedForUser: string | null = null

/**
 * Ensures the user always has at least one character.
 * If the character list is empty, auto-creates a default character.
 *
 * Safe to call from multiple screens — a module-level flag prevents
 * duplicate creation even when React Query hasn't settled yet.
 * isCreatingDefault is reactive across all mounted screens via useIsMutating.
 */
export function useEnsureDefaultCharacter() {
    const authService = useAuthMachine();
    const user = useSelector(authService, (state) => state.context.user);
    const { characters, isLoading } = useCharacters()
    const createCharacterMutation = useCreateCharacter()
    const isMutating = useIsMutating({ mutationKey: createCharacterMutationKey(user?.uid) })

    // Reset the per-user failure flag whenever the user changes.
    const prevUidRef = useRef<string | null | undefined>(undefined)
    useEffect(() => {
        if (prevUidRef.current !== undefined && prevUidRef.current !== user?.uid) {
            creationFailedForUser = null
            creationInFlight = false
        }
        prevUidRef.current = user?.uid
    }, [user?.uid])

    useEffect(() => {
        if (
            !isLoading &&
            user &&
            characters !== undefined &&
            characters.length === 0 &&
            !creationInFlight &&
            isMutating === 0 &&
            creationFailedForUser !== user.uid
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
                    onSettled: (_data, error) => {
                        creationInFlight = false
                        if (error) {
                            creationFailedForUser = user.uid
                        } else {
                            creationFailedForUser = null
                        }
                    },
                },
            )
        }
    }, [isLoading, user, characters, createCharacterMutation, isMutating])

    return {
        isCreatingDefault: isMutating > 0,
    }
}
