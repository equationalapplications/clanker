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

  const characterId =
    activeCharacterId ??
    mostRecentMessage?.character_id ??
    devLinkedCharacterId ??
    defaultCharacterId ??
    characters?.[0]?.id

  return {
    characterId,
    isLoading: isLoadingMessage || isLoadingCharacters,
    isCreatingDefault,
  }
}
