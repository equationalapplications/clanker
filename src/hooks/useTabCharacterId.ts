import { useSelector } from '@xstate/react'
import { useActiveCharacterId } from '~/hooks/useActiveCharacterId'
import { useCharacters } from '~/hooks/useCharacters'
import { useMostRecentMessage } from '~/hooks/useMessages'
import { useAuthMachine, useCharacterMachine } from '~/hooks/useMachines'
import { isDevSandboxEnabled } from '~/auth/ensureDevSandboxCharacter'
import { DEV_CLOUD_CHARACTER_ID } from '../../shared/dev-sandbox'

/** Resolves the character for Chat/Talk tabs: last viewed in Chat, then recent message, then defaults. */
export function useTabCharacterId(): {
  characterId: string | undefined
  isLoading: boolean
  isCreatingDefault: boolean
} {
  const activeCharacterId = useActiveCharacterId()
  const { data: mostRecentMessage, isLoading: isLoadingMessage } = useMostRecentMessage()
  const { characters, isLoading: isLoadingCharacters } = useCharacters()
  const characterService = useCharacterMachine()
  const authService = useAuthMachine()
  const defaultCharacterId = useSelector(
    authService,
    (s) => s.context.dbUser?.defaultCharacterId ?? null,
  )
  const isCreatingDefault = useSelector(characterService, (s) => s.matches('creatingDefault'))

  const devLinkedCharacterId = isDevSandboxEnabled()
    ? characters?.find((c) => c.cloud_id === DEV_CLOUD_CHARACTER_ID)?.id
    : undefined

  const characterIds = new Set(characters?.map((c) => c.id))

  const validatedActiveCharacterId =
    activeCharacterId && characterIds.has(activeCharacterId) ? activeCharacterId : undefined

  const validatedMostRecentCharacterId =
    mostRecentMessage?.character_id && characterIds.has(mostRecentMessage.character_id)
      ? mostRecentMessage.character_id
      : undefined

  const validatedDefaultCharacterId =
    defaultCharacterId && characterIds.has(defaultCharacterId) ? defaultCharacterId : undefined

  const validatedDevLinkedCharacterId =
    devLinkedCharacterId && characterIds.has(devLinkedCharacterId) ? devLinkedCharacterId : undefined

  const characterId =
    validatedActiveCharacterId ??
    validatedMostRecentCharacterId ??
    validatedDevLinkedCharacterId ??
    validatedDefaultCharacterId ??
    characters?.[0]?.id

  return {
    characterId,
    isLoading: isLoadingMessage || isLoadingCharacters,
    isCreatingDefault,
  }
}
