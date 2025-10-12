/**
 * React Query hooks for character management with local SQLite storage
 *
 * Features:
 * - Local-first data storage
 * - Automatic caching and background updates
 * - Optimistic updates for mutations
 * - Offline support (characters always stored locally)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '~/auth/useAuth'
import {
  getUserCharacters,
  getCharacter,
  createCharacter,
  updateCharacter,
  deleteCharacter,
  Character,
  CharacterInsert,
  CharacterUpdate,
  LegacyCharacter,
  toLegacyCharacter,
} from '~/services/characterService'

/**
 * Query key factory for characters
 * Centralizes key management to avoid typos and ensure consistency
 */
export const characterKeys = {
  all: ['characters'] as const,
  lists: () => [...characterKeys.all, 'list'] as const,
  list: (userId: string | undefined) => [...characterKeys.lists(), userId] as const,
  details: () => [...characterKeys.all, 'detail'] as const,
  detail: (id: string) => [...characterKeys.details(), id] as const,
}

/**
 * Hook to get all user characters with React Query
 * Provides caching, background updates, and offline support
 */
export function useCharacters() {
  const { user } = useAuth()

  // Main query for characters
  const query = useQuery({
    queryKey: characterKeys.list(user?.uid),
    queryFn: () => getUserCharacters(user?.uid || ''),
    enabled: !!user,
    staleTime: 1000 * 60 * 2, // 2 minutes
  })

  // Convert to legacy format for compatibility
  const legacyCharacters: LegacyCharacter[] = (query.data || []).map(toLegacyCharacter)

  return {
    ...query,
    characters: legacyCharacters,
  }
}

/**
 * Hook to get a single character with React Query
 */
export function useCharacter(id: string | undefined) {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const query = useQuery({
    queryKey: characterKeys.detail(id || ''),
    queryFn: () => getCharacter(id || '', user?.uid || ''),
    enabled: !!id && !!user,
    staleTime: 1000 * 60 * 5, // 5 minutes
    // Try to get initial data from the list query cache
    initialData: () => {
      const listsCache = queryClient.getQueriesData<Character[]>({
        queryKey: characterKeys.lists(),
      })
      for (const [, characters] of listsCache) {
        const character = characters?.find((c) => c.id === id)
        if (character) return character
      }
      return undefined
    },
  })

  const legacyCharacter = query.data ? toLegacyCharacter(query.data) : null

  return {
    ...query,
    character: legacyCharacter,
  }
}

/**
 * Mutation hook to create a new character with optimistic update
 */
export function useCreateCharacter() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: (character: CharacterInsert) => createCharacter(user?.uid || '', character),

    // Optimistic update: add character immediately to UI
    onMutate: async (newCharacter) => {
      await queryClient.cancelQueries({ queryKey: characterKeys.list(user?.uid) })

      const previousCharacters = queryClient.getQueryData<Character[]>(
        characterKeys.list(user?.uid),
      )

      // Optimistically add the new character with temporary ID
      const optimisticCharacter: Character = {
        id: `temp-${Date.now()}`,
        user_id: user?.uid || '',
        name: newCharacter.name,
        appearance: newCharacter.appearance || null,
        traits: newCharacter.traits || null,
        emotions: newCharacter.emotions || null,
        context: newCharacter.context || null,
        avatar: newCharacter.avatar || null,
        is_public: newCharacter.is_public || false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      queryClient.setQueryData<Character[]>(characterKeys.list(user?.uid), (old) => [
        optimisticCharacter,
        ...(old || []),
      ])

      return { previousCharacters, optimisticCharacter }
    },

    onSuccess: (data, variables, context) => {
      console.log('✅ Character created successfully:', data?.id)

      // Replace optimistic character with real one
      queryClient.setQueryData<Character[]>(characterKeys.list(user?.uid), (old) => {
        if (!old || !data) return old
        return old.map((char) => (char.id === context?.optimisticCharacter.id ? data : char))
      })

      // Cache the new character detail
      if (data) {
        queryClient.setQueryData(characterKeys.detail(data.id), data)
      }
    },

    onError: (error, variables, context) => {
      console.error('❌ Failed to create character:', error)

      // Rollback optimistic update
      if (context?.previousCharacters) {
        queryClient.setQueryData(characterKeys.list(user?.uid), context.previousCharacters)
      }
    },
  })
}

/**
 * Mutation hook to update a character with optimistic update
 */
export function useUpdateCharacter() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: CharacterUpdate }) =>
      updateCharacter(id, user?.uid || '', updates),

    // Optimistic update: apply changes immediately
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: characterKeys.detail(id) })
      await queryClient.cancelQueries({ queryKey: characterKeys.list(user?.uid) })

      const previousCharacter = queryClient.getQueryData<Character>(characterKeys.detail(id))
      const previousCharacters = queryClient.getQueryData<Character[]>(
        characterKeys.list(user?.uid),
      )

      // Optimistically update the character
      queryClient.setQueryData<Character>(characterKeys.detail(id), (old) => {
        if (!old) return old
        return { ...old, ...updates, updated_at: new Date().toISOString() }
      })

      queryClient.setQueryData<Character[]>(characterKeys.list(user?.uid), (old) => {
        if (!old) return old
        return old.map((char) =>
          char.id === id ? { ...char, ...updates, updated_at: new Date().toISOString() } : char,
        )
      })

      return { previousCharacter, previousCharacters, id }
    },

    onSuccess: (data, variables) => {
      console.log('✅ Character updated successfully:', variables.id)

      // Update with real data from server
      if (data) {
        queryClient.setQueryData(characterKeys.detail(variables.id), data)

        queryClient.setQueryData<Character[]>(characterKeys.list(user?.uid), (old) => {
          if (!old) return old
          return old.map((char) => (char.id === data.id ? data : char))
        })
      }
    },

    onError: (error, variables, context) => {
      console.error('❌ Failed to update character:', error)

      // Rollback optimistic updates
      if (context?.previousCharacter) {
        queryClient.setQueryData(characterKeys.detail(context.id), context.previousCharacter)
      }
      if (context?.previousCharacters) {
        queryClient.setQueryData(characterKeys.list(user?.uid), context.previousCharacters)
      }
    },
  })
}

/**
 * Mutation hook to delete a character with optimistic update
 */
export function useDeleteCharacter() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: (id: string) => deleteCharacter(id, user?.uid || ''),

    // Optimistic update: remove character immediately
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: characterKeys.list(user?.uid) })

      const previousCharacters = queryClient.getQueryData<Character[]>(
        characterKeys.list(user?.uid),
      )

      // Optimistically remove the character
      queryClient.setQueryData<Character[]>(
        characterKeys.list(user?.uid),
        (old) => old?.filter((char) => char.id !== id) || [],
      )

      return { previousCharacters, id }
    },

    onSuccess: (data, id) => {
      console.log('✅ Character deleted successfully:', id)

      // Remove from detail cache
      queryClient.removeQueries({ queryKey: characterKeys.detail(id) })
    },

    onError: (error, id, context) => {
      console.error('❌ Failed to delete character:', error)

      // Rollback optimistic update
      if (context?.previousCharacters) {
        queryClient.setQueryData(characterKeys.list(user?.uid), context.previousCharacters)
      }
    },
  })
}

/**
 * Legacy hook for backward compatibility
 * Use useCharacters() for new code
 */
export function useCharacterList(): LegacyCharacter[] {
  const { characters } = useCharacters()
  return characters
}
