import { useSelector } from '@xstate/react'
import { useCharacterMachine } from '~/hooks/useMachines'
import type { CharacterInsert, CharacterUpdate } from '~/services/characterService'

// NEW: Thin selector hooks over the machine

export function useCharacters() {
  const characterService = useCharacterMachine()
  const characters = useSelector(characterService, (s) => s.context.characters)
  const isLoading = useSelector(characterService, (s) => s.matches('loading'))
  return { characters, isLoading }
}

export function useCharacter(id: string | undefined) {
  const characterService = useCharacterMachine()
  const character = useSelector(
    characterService,
    (s) => s.context.characters.find((c) => c.id === id) ?? null,
  )
  const isLoading = useSelector(characterService, (s) => s.matches('loading'))
  return { data: character, character, isLoading }
}

export function useCreateCharacter() {
  const characterService = useCharacterMachine()
  const isPending = useSelector(characterService, (s) => s.matches('creating'))
  const pendingCharacterId = useSelector(characterService, (s) => s.context.pendingCharacterId)

  const create = (data: CharacterInsert) => {
    characterService.send({ type: 'CREATE', data })
  }

  return { create, isPending, pendingCharacterId }
}

export function useUpdateCharacter() {
  const characterService = useCharacterMachine()
  const isPending = useSelector(characterService, (s) => s.matches('updating'))
  const error = useSelector(characterService, (s) => s.context.error)

  const update = (id: string, updates: CharacterUpdate) => {
    characterService.send({ type: 'UPDATE', id, updates })
  }

  return { update, isPending, error }
}

export function useDeleteCharacter() {
  const characterService = useCharacterMachine()
  const isPending = useSelector(characterService, (s) => s.matches('deleting'))

  const remove = (id: string) => {
    characterService.send({ type: 'DELETE', id })
  }

  return { remove, isPending }
}

export function useSyncCharacters() {
  const characterService = useCharacterMachine()
  const isCloudSyncing = useSelector(characterService, (s) => s.matches('cloudSyncing'))
  const error = useSelector(characterService, (s) => s.context.error)

  const sync = () => {
    characterService.send({ type: 'CLOUD_SYNC' })
  }

  return { sync, isCloudSyncing, error }
}

export function useUnsyncCharacter() {
  const characterService = useCharacterMachine()
  const isCloudUnsyncing = useSelector(characterService, (s) => s.matches('cloudUnsyncing'))
  const error = useSelector(characterService, (s) => s.context.error)

  const unsync = (id: string) => {
    characterService.send({ type: 'CLOUD_UNSYNC', id })
  }

  return { unsync, isCloudUnsyncing, error }
}
