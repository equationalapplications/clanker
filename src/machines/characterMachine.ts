import { createMachine, assign, fromPromise } from 'xstate'
import {
  Character,
  CharacterInsert,
  CharacterUpdate,
} from '~/services/characterService'
import {
  getUserCharacters,
  createCharacter as createCharacterDb,
  updateCharacter as updateCharacterDb,
  deleteCharacter as deleteCharacterDb,
} from '~/database/characterDatabase'
import {
  syncAllToCloud,
  restoreFromCloud,
  removeCharacterFromCloud,
} from '~/services/characterSyncService'
import { loadDefaultAvatarBase64 } from '~/services/defaultAvatarService'

// Events
type CharacterEvent =
  | { type: 'LOAD' }
  | { type: 'CREATE'; data: CharacterInsert }
  | { type: 'UPDATE'; id: string; updates: CharacterUpdate }
  | { type: 'DELETE'; id: string }
  | { type: 'USER_CHANGED'; userId: string | null }
  | { type: 'CHARACTERS_SYNCED'; characters: Character[] }
  | { type: 'CLEAR_PENDING_NAV' }
  | { type: 'CLOUD_SYNC' }
  | { type: 'CLOUD_UNSYNC'; id: string }

// Context
interface CharacterContext {
  characters: Character[]
  userId: string | null
  error: Error | null
  pendingCharacterId: string | null
  optimisticSnapshot: Character[] | null // for rollback
  pendingTempId: string | null
  priorSaveToCloud: boolean | null
  priorCloudId: string | null
  pendingUnsyncId: string | null
}

const DEFAULT_CHARACTER_INSERT: CharacterInsert = {
  name: 'Clanker',
  is_public: false,
  appearance: 'A sturdy mechanical companion with a practical, well-worn chassis.',
  traits: 'Loyal, curious, resourceful, and a little sarcastic.',
  emotions: 'Calm, attentive, and eager to help.',
  context: 'A newly created companion character ready to chat and develop its personality.',
}

const createDefaultCharacterActor = fromPromise(
  async ({ input }: { input: { userId: string | null } }) => {
    if (!input.userId) {
      throw new Error('Cannot create default character: no userId')
    }

    let normalizedAvatarData: string | undefined

    // Best-effort avatar load: do not block onboarding if this fails.
    try {
      const avatarData = await loadDefaultAvatarBase64()
      normalizedAvatarData = avatarData || undefined
    } catch (error) {
      console.warn('Failed to load default avatar; creating default character without avatar_data', error)
      normalizedAvatarData = undefined
    }

    const characterWithAvatar: CharacterInsert = {
      ...DEFAULT_CHARACTER_INSERT,
      avatar_data: normalizedAvatarData,
    }

    const newCharacter = await createCharacterDb(input.userId, characterWithAvatar)
    if (!newCharacter) {
      throw new Error('Failed to create default character')
    }
    return newCharacter
  },
)

export const characterMachine = createMachine(
  {
    id: 'characters',
    types: {} as {
      context: CharacterContext
      events: CharacterEvent
    },
    initial: 'loading',
    context: {
      characters: [],
      userId: null,
      error: null,
      pendingCharacterId: null,
      optimisticSnapshot: null,
      pendingTempId: null,
      priorSaveToCloud: null,
      priorCloudId: null,
      pendingUnsyncId: null,
    } as CharacterContext,
    on: {
      USER_CHANGED: {
        target: '.loading',
        actions: assign({
          userId: ({ event }) => event.userId,
          characters: [],
          error: null,
          pendingCharacterId: null,
          optimisticSnapshot: null,
          pendingTempId: null,
          priorSaveToCloud: null,
          priorCloudId: null,
          pendingUnsyncId: null,
        }),
      },
      LOAD: [
        {
          guard: ({ context }) => context.optimisticSnapshot !== null,
        },
        {
          target: '.loading',
        },
      ],
      CLEAR_PENDING_NAV: {
        actions: assign({
          pendingCharacterId: null,
        }),
      },
    },
    states: {
      idle: {
        on: {
          CREATE: 'creating',
          UPDATE: 'updating',
          DELETE: 'deleting',
          CHARACTERS_SYNCED: {
            actions: assign({
              characters: ({ event }) => event.characters,
            }),
          },
          CLOUD_SYNC: 'cloudSyncing',
          CLOUD_UNSYNC: {
            target: 'cloudUnsyncing',
            actions: assign({
              pendingUnsyncId: ({ event }) => event.id,
            }),
          },
        },
      },
      loading: {
        invoke: {
          id: 'loadCharacters',
          src: 'loadCharactersActor',
          input: ({ context }) => ({ userId: context.userId }),
          onDone: {
            target: 'checkingDefault',
            actions: assign({
              characters: ({ event }) => event.output,
              error: null,
            }),
          },
          onError: {
            target: 'idle',
            actions: assign({
              error: ({ event }) => event.error as Error | null,
            }),
          },
        },
      },
      checkingDefault: {
        always: [
          { target: 'idle', guard: 'hasCharacters' },
          { target: 'creatingDefault', guard: 'hasUserId' },
          { target: 'idle' },
        ],
      },
      creatingDefault: {
        on: { LOAD: {} },
        invoke: {
          id: 'createDefaultCharacter',
          src: createDefaultCharacterActor,
          input: ({ context }) => ({ userId: context.userId }),
          onDone: {
            target: 'idle',
            actions: assign({
              characters: ({ context, event }) => [event.output, ...context.characters],
              error: null,
            }),
          },
          onError: {
            target: 'idle',
            actions: assign({
              error: ({ event }) => event.error as Error | null,
            }),
          },
        },
      },
      creating: {
        entry: assign(({ context, event }) => {
          if (event.type !== 'CREATE') {
            return {
              error: null,
              optimisticSnapshot: context.characters,
            }
          }

          if (!context.userId) {
            return {
              error: null,
              optimisticSnapshot: context.characters,
            }
          }

          const tempId = `temp-${Date.now()}`
          const now = new Date().toISOString()
          const optimisticCharacter: Character = {
            id: tempId,
            user_id: context.userId,
            owner_user_id: context.userId,
            name: event.data.name,
            is_public: event.data.is_public ?? false,
            created_at: now,
            updated_at: now,
            avatar: event.data.avatar ?? null,
            appearance: event.data.appearance ?? null,
            traits: event.data.traits ?? null,
            emotions: event.data.emotions ?? null,
            context: event.data.context ?? null,
          }

          return {
            error: null,
            optimisticSnapshot: context.characters,
            pendingTempId: tempId,
            characters: [optimisticCharacter, ...context.characters],
          }
        }),
        invoke: {
          id: 'createCharacter',
          src: 'createCharacterActor',
          input: ({ context, event }) => {
            if (event.type !== 'CREATE') throw new Error('Invalid event')
            return { userId: context.userId, data: event.data }
          },
          onDone: {
            target: 'idle',
            actions: assign({
              characters: ({ context, event }) =>
                context.characters.map((c) =>
                  c.id === context.pendingTempId ? event.output : c,
                ),
              pendingCharacterId: ({ event }) => event.output.id,
              optimisticSnapshot: null,
              error: null,
              pendingTempId: null,
            }),
          },
          onError: {
            target: 'idle',
            actions: assign({
              error: ({ event }) => event.error as Error | null,
              characters: ({ context }) => context.optimisticSnapshot ?? [],
              optimisticSnapshot: null,
              pendingTempId: null,
            }),
          },
        },
      },
      updating: {
        entry: assign({
          error: null,
          optimisticSnapshot: ({ context }) => context.characters,
          priorSaveToCloud: ({ context, event }) => {
            if (event.type !== 'UPDATE') return null
            const char = context.characters.find((c) => c.id === event.id)
            return char?.save_to_cloud ?? null
          },
          priorCloudId: ({ context, event }) => {
            if (event.type !== 'UPDATE') return null
            const char = context.characters.find((c) => c.id === event.id)
            return char?.cloud_id ?? null
          },
          pendingUnsyncId: ({ event }) => {
            if (event.type !== 'UPDATE') return null
            return event.id
          },
          characters: ({ context, event }) => {
            if (event.type !== 'UPDATE') return context.characters
            return context.characters.map((c) =>
              c.id === event.id ? { ...c, ...event.updates, updated_at: new Date().toISOString() } : c,
            )
          },
        }),
        invoke: {
          id: 'updateCharacter',
          src: 'updateCharacterActor',
          input: ({ context, event }) => {
            if (event.type !== 'UPDATE') throw new Error('Invalid event')
            return { userId: context.userId, id: event.id, updates: event.updates }
          },
          onDone: [
            {
              guard: 'updateTurnedOnCloud',
              target: 'cloudSyncing',
              actions: assign({
                characters: ({ context, event }) =>
                  context.characters.map((c) => (c.id === event.output.id ? event.output : c)),
                optimisticSnapshot: null,
                error: null,
              }),
            },
            {
              guard: 'updateTurnedOffCloudWithCloudId',
              target: 'cloudUnsyncing',
              actions: assign({
                characters: ({ context, event }) =>
                  context.characters.map((c) => (c.id === event.output.id ? event.output : c)),
                optimisticSnapshot: null,
                error: null,
              }),
            },
            {
              target: 'idle',
              actions: assign({
                characters: ({ context, event }) =>
                  context.characters.map((c) => (c.id === event.output.id ? event.output : c)),
                optimisticSnapshot: null,
                error: null,
                priorSaveToCloud: null,
                priorCloudId: null,
                pendingUnsyncId: null,
              }),
            },
          ],
          onError: {
            target: 'idle',
            actions: assign({
              error: ({ event }) => event.error as Error | null,
              characters: ({ context }) => context.optimisticSnapshot ?? [],
              optimisticSnapshot: null,
            }),
          },
        },
      },
      cloudSyncing: {
        on: {
          LOAD: {},
          CREATE: {},
          UPDATE: {},
          DELETE: {},
          CLOUD_SYNC: {},
          CLOUD_UNSYNC: {},
        },
        invoke: {
          id: 'cloudSync',
          src: 'cloudSyncActor',
          input: ({ context }) => ({ userId: context.userId }),
          onDone: {
            target: 'loading',
            actions: assign({
              priorSaveToCloud: null,
              priorCloudId: null,
              pendingUnsyncId: null,
              error: null,
            }),
          },
          onError: {
            target: 'idle',
            actions: assign({
              error: ({ event }) => event.error as Error | null,
              priorSaveToCloud: null,
              priorCloudId: null,
              pendingUnsyncId: null,
            }),
          },
        },
      },
      cloudUnsyncing: {
        on: {
          LOAD: {},
          CREATE: {},
          UPDATE: {},
          DELETE: {},
          CLOUD_SYNC: {},
          CLOUD_UNSYNC: {},
        },
        invoke: {
          id: 'cloudUnsync',
          src: 'cloudUnsyncActor',
          input: ({ context }) => ({
            userId: context.userId,
            id: context.pendingUnsyncId ?? '',
          }),
          onDone: {
            target: 'loading',
            actions: assign({
              priorSaveToCloud: null,
              priorCloudId: null,
              pendingUnsyncId: null,
              error: null,
            }),
          },
          onError: {
            target: 'idle',
            actions: assign({
              error: ({ event }) => event.error as Error | null,
              priorSaveToCloud: null,
              priorCloudId: null,
              pendingUnsyncId: null,
            }),
          },
        },
      },
      deleting: {
        entry: assign({
          error: null,
          optimisticSnapshot: ({ context }) => context.characters,
          characters: ({ context, event }) => {
            if (event.type !== 'DELETE') return context.characters
            return context.characters.filter((c) => c.id !== event.id)
          },
        }),
        invoke: {
          id: 'deleteCharacter',
          src: 'deleteCharacterActor',
          input: ({ context, event }) => {
            if (event.type !== 'DELETE') throw new Error('Invalid event')
            return { userId: context.userId, id: event.id }
          },
          onDone: {
            target: 'idle',
            actions: assign({
              optimisticSnapshot: null,
              error: null,
            }),
          },
          onError: {
            target: 'idle',
            actions: assign({
              error: ({ event }) => event.error as Error | null,
              characters: ({ context }) => context.optimisticSnapshot ?? [],
              optimisticSnapshot: null,
            }),
          },
        },
      },
    },
  },
  {
    actions: {},
    actors: {
      loadCharactersActor: fromPromise(async ({ input }: { input: { userId: string | null } }) => {
        if (!input.userId) return []
        return getUserCharacters(input.userId)
      }),
      createCharacterActor: fromPromise(
        async ({ input }: { input: { userId: string | null; data: CharacterInsert } }) => {
          if (!input.userId) throw new Error('User not logged in')
          const newCharacter = await createCharacterDb(input.userId, input.data)
          if (!newCharacter) throw new Error('Failed to create character')
          return newCharacter
        },
      ),
      updateCharacterActor: fromPromise(
        async ({
          input,
        }: {
          input: { userId: string | null; id: string; updates: CharacterUpdate }
        }) => {
          if (!input.userId) throw new Error('User not logged in')
          const updatedCharacter = await updateCharacterDb(input.id, input.userId, input.updates)
          if (!updatedCharacter) throw new Error('Failed to update character')
          return updatedCharacter
        },
      ),
      deleteCharacterActor: fromPromise(
        async ({ input }: { input: { userId: string | null; id: string } }) => {
          if (!input.userId) throw new Error('User not logged in')
          await deleteCharacterDb(input.id, input.userId)
        },
      ),
      cloudSyncActor: fromPromise(
        async ({ input }: { input: { userId: string | null } }) => {
          if (!input.userId) throw new Error('User not logged in')
          await syncAllToCloud(input.userId)
          await restoreFromCloud(input.userId)
        },
      ),
      cloudUnsyncActor: fromPromise(
        async ({ input }: { input: { userId: string | null; id: string } }) => {
          if (!input.userId) throw new Error('User not logged in')
          await removeCharacterFromCloud(input.id, input.userId)
        },
      ),
    },
    guards: {
      hasCharacters: ({ context }) => context.characters.length > 0,
      hasUserId: ({ context }) => context.userId !== null,
      updateTurnedOnCloud: ({ event }) => {
        const output = (event as { output?: { save_to_cloud?: boolean } }).output
        return output?.save_to_cloud === true
      },
      updateTurnedOffCloudWithCloudId: ({ context, event }) => {
        const output = (event as { output?: { save_to_cloud?: boolean } }).output
        return (
          output?.save_to_cloud !== true &&
          context.priorSaveToCloud === true &&
          Boolean(context.priorCloudId)
        )
      },
    },
    delays: {},
  },
)
