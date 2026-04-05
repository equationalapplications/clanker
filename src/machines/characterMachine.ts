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

// Events
type CharacterEvent =
  | { type: 'LOAD' }
  | { type: 'CREATE'; data: CharacterInsert }
  | { type: 'UPDATE'; id: string; updates: CharacterUpdate }
  | { type: 'DELETE'; id: string }
  | { type: 'USER_CHANGED'; userId: string | null }
  | { type: 'CHARACTERS_SYNCED'; characters: Character[] }
  | { type: 'CLEAR_PENDING_NAV' }

// Context
interface CharacterContext {
  characters: Character[]
  userId: string | null
  error: Error | null
  pendingCharacterId: string | null
  optimisticSnapshot: Character[] | null // for rollback
}

const createDefaultCharacterActor = fromPromise(
  async ({ input }: { input: { userId: string | null } }) => {
  console.log('--- machine --- create default character actor', input.userId)
  if (!input.userId) {
    throw new Error('Cannot create default character: no userId')
  }
  const newCharacter = await createCharacterDb(input.userId, {
    name: 'Clanker',
    is_public: false,
  })
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
        }),
      },
      LOAD: '.loading',
      CHARACTERS_SYNCED: {
        actions: assign({
          characters: ({ event }) => event.characters,
        }),
      },
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
        invoke: {
          id: 'createDefaultCharacter',
          src: createDefaultCharacterActor,
          input: ({ context }) => ({ userId: context.userId }),
          onDone: {
            target: 'idle',
            actions: assign({
              characters: ({ context, event }) => [event.output, ...context.characters],
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
        entry: assign({
          optimisticSnapshot: ({ context }) => context.characters,
          characters: ({ context, event }) => {
            if (event.type !== 'CREATE') return context.characters
            if (!context.userId) return context.characters // Should be guarded by UI, but as a safeguard.
            const optimisticCharacter: Character = {
              id: `temp-${Date.now()}`,
              user_id: context.userId,
              name: event.data.name,
              is_public: event.data.is_public ?? false,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              avatar: event.data.avatar ?? null,
              appearance: event.data.appearance ?? null,
              traits: event.data.traits ?? null,
              emotions: event.data.emotions ?? null,
              context: event.data.context ?? null,
            }
            return [optimisticCharacter, ...context.characters]
          },
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
                context.characters.map((c) => (c.id.startsWith('temp-') ? event.output : c)),
              pendingCharacterId: ({ event }) => event.output.id,
              optimisticSnapshot: null,
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
      updating: {
        entry: assign({
          optimisticSnapshot: ({ context }) => context.characters,
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
          onDone: {
            target: 'idle',
            actions: assign({
              characters: ({ context, event }) =>
                context.characters.map((c) => (c.id === event.output.id ? event.output : c)),
              optimisticSnapshot: null,
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
      deleting: {
        entry: assign({
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
    },
    guards: {
      hasCharacters: ({ context }) => context.characters.length > 0,
      hasUserId: ({ context }) => context.userId !== null,
    },
    delays: {},
  },
)
