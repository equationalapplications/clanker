import { createActor, waitFor } from 'xstate'
import { characterMachine } from '../src/machines/characterMachine'
import * as characterDatabase from '../src/database/characterDatabase'

jest.mock('../src/database/characterDatabase')
jest.mock('../src/services/defaultAvatarService', () => ({
  loadDefaultAvatarBase64: jest.fn().mockResolvedValue('default-avatar'),
}))

const mockDb = jest.mocked(characterDatabase)

// Derive from the database function so synced_to_cloud and cloud_id are required,
// matching what the mocks expect to return.
type DbCharacter = NonNullable<Awaited<ReturnType<typeof characterDatabase.createCharacter>>>

const USER_ID = 'user-1'
const NOW = '2024-01-01T00:00:00.000Z'

function makeCharacter(overrides: Partial<DbCharacter> = {}): DbCharacter {
  return {
    id: 'char-1',
    user_id: USER_ID,
    name: 'Test Character',
    is_public: false,
    avatar: null,
    appearance: null,
    traits: null,
    emotions: null,
    context: null,
    created_at: NOW,
    updated_at: NOW,
    synced_to_cloud: false,
    cloud_id: null,
    ...overrides,
  }
}

const WAIT_OPTS = { timeout: 2000 }

/**
 * Start the machine, advance through the null-user initial load to idle,
 * then apply USER_CHANGED and wait for idle again.
 *
 * By default provides one character so the machine skips creatingDefault.
 */
async function bootWithUser(
  characters: DbCharacter[] = [makeCharacter()],
  userId = USER_ID,
) {
  mockDb.getUserCharacters.mockResolvedValue(characters)
  const actor = createActor(characterMachine)
  actor.start()
  // null userId → loadCharactersActor short-circuits to [] → idle (no default, no userId)
  await waitFor(actor, (s) => s.matches('idle'), WAIT_OPTS)
  actor.send({ type: 'USER_CHANGED', userId })
  // Real load → checkingDefault → idle (characters provided so no default creation needed)
  await waitFor(actor, (s) => s.matches('idle'), WAIT_OPTS)
  return actor
}

// ---------------------------------------------------------------------------
// Initial load
// ---------------------------------------------------------------------------
describe('initial load', () => {
  it('starts in loading state before any promise resolves', () => {
    // Keep getUserCharacters pending so the machine stays in loading
    mockDb.getUserCharacters.mockReturnValue(new Promise(() => {}))
    const actor = createActor(characterMachine)
    actor.start()
    expect(actor.getSnapshot().matches('loading')).toBe(true)
    actor.stop()
  })

  it('transitions to idle with empty list when userId is null', async () => {
    mockDb.getUserCharacters.mockResolvedValue([])
    const actor = createActor(characterMachine)
    actor.start()
    await waitFor(actor, (s) => s.matches('idle'), WAIT_OPTS)
    expect(actor.getSnapshot().context.characters).toEqual([])
    actor.stop()
  })

  it('loads characters for a real userId after USER_CHANGED', async () => {
    const char = makeCharacter()
    const actor = await bootWithUser([char])
    expect(actor.getSnapshot().context.characters).toEqual([char])
    expect(actor.getSnapshot().context.userId).toBe(USER_ID)
    actor.stop()
  })
})

// ---------------------------------------------------------------------------
// LOAD event
// ---------------------------------------------------------------------------
describe('LOAD event', () => {
  it('triggers a reload when dispatched in idle', async () => {
    const char = makeCharacter()
    const actor = await bootWithUser([char])

    const updatedChar = makeCharacter({ name: 'Updated' })
    mockDb.getUserCharacters.mockResolvedValue([updatedChar])

    actor.send({ type: 'LOAD' })
    await waitFor(actor, (s) => s.matches('idle'), WAIT_OPTS)

    expect(actor.getSnapshot().context.characters).toEqual([updatedChar])
    actor.stop()
  })

  it('is a no-op when optimisticSnapshot is set (during in-flight operation)', async () => {
    const char = makeCharacter()
    const actor = await bootWithUser([char])

    // Hold createCharacter pending so optimistic state is preserved
    let resolveCreate!: (c: DbCharacter | null) => void
    mockDb.createCharacter.mockReturnValue(
      new Promise<DbCharacter | null>((resolve) => {
        resolveCreate = resolve
      }),
    )

    actor.send({ type: 'CREATE', data: { name: 'New', is_public: false } })
    expect(actor.getSnapshot().matches('creating')).toBe(true)
    expect(actor.getSnapshot().context.optimisticSnapshot).not.toBeNull()

    // LOAD must be swallowed — machine must remain in 'creating'
    actor.send({ type: 'LOAD' })
    expect(actor.getSnapshot().matches('creating')).toBe(true)

    // Resolve to clean up
    resolveCreate(makeCharacter({ id: 'char-2' }))
    await waitFor(actor, (s) => s.matches('idle'), WAIT_OPTS)
    actor.stop()
  })
})

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------
describe('CREATE', () => {
  it('optimistically prepends character with a temp id', async () => {
    const existing = makeCharacter()
    const actor = await bootWithUser([existing])

    mockDb.createCharacter.mockReturnValue(new Promise(() => {})) // keep pending

    actor.send({ type: 'CREATE', data: { name: 'Optimistic', is_public: false } })

    const snap = actor.getSnapshot()
    expect(snap.matches('creating')).toBe(true)
    expect(snap.context.characters).toHaveLength(2)
    expect(snap.context.characters[0].id).toMatch(/^temp-/)
    expect(snap.context.characters[0].name).toBe('Optimistic')
    expect(snap.context.optimisticSnapshot).toEqual([existing])

    actor.stop()
  })

  it('replaces temp character with real one and sets pendingCharacterId on success', async () => {
    const existing = makeCharacter()
    const actor = await bootWithUser([existing])

    const created = makeCharacter({ id: 'char-real', name: 'Real' })
    mockDb.createCharacter.mockResolvedValue(created)

    actor.send({ type: 'CREATE', data: { name: 'Real', is_public: false } })
    await waitFor(actor, (s) => s.matches('idle'), WAIT_OPTS)

    const snap = actor.getSnapshot()
    expect(snap.context.characters).toHaveLength(2)
    expect(snap.context.characters.find((c) => c.id === 'char-real')).toEqual(created)
    expect(snap.context.characters.find((c) => c.id.startsWith('temp-'))).toBeUndefined()
    expect(snap.context.pendingCharacterId).toBe('char-real')
    expect(snap.context.optimisticSnapshot).toBeNull()
    expect(snap.context.error).toBeNull()
    actor.stop()
  })

  it('rolls back to optimisticSnapshot and sets error on failure', async () => {
    const existing = makeCharacter()
    const actor = await bootWithUser([existing])

    mockDb.createCharacter.mockRejectedValue(new Error('DB error'))

    actor.send({ type: 'CREATE', data: { name: 'Fail', is_public: false } })
    await waitFor(actor, (s) => s.matches('idle'), WAIT_OPTS)

    const snap = actor.getSnapshot()
    expect(snap.context.characters).toEqual([existing])
    expect(snap.context.optimisticSnapshot).toBeNull()
    expect(snap.context.error).toBeInstanceOf(Error)
    actor.stop()
  })

  it('clears error on entry to creating state', async () => {
    const existing = makeCharacter()
    // Cause an error first
    const actor = await bootWithUser([existing])
    mockDb.createCharacter.mockRejectedValue(new Error('first error'))
    actor.send({ type: 'CREATE', data: { name: 'Fail', is_public: false } })
    await waitFor(actor, (s) => s.matches('idle'), WAIT_OPTS)
    expect(actor.getSnapshot().context.error).not.toBeNull()

    // Second create succeeds — error must be cleared on entry
    mockDb.createCharacter.mockReturnValue(new Promise(() => {})) // keep pending
    actor.send({ type: 'CREATE', data: { name: 'Second', is_public: false } })
    expect(actor.getSnapshot().context.error).toBeNull()
    actor.stop()
  })
})

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------
describe('UPDATE', () => {
  it('optimistically updates character in place', async () => {
    const char = makeCharacter()
    const actor = await bootWithUser([char])

    mockDb.updateCharacter.mockReturnValue(new Promise(() => {})) // keep pending

    actor.send({ type: 'UPDATE', id: 'char-1', updates: { name: 'Updated Name' } })

    const snap = actor.getSnapshot()
    expect(snap.matches('updating')).toBe(true)
    expect(snap.context.characters[0].name).toBe('Updated Name')
    expect(snap.context.optimisticSnapshot).toEqual([char])

    actor.stop()
  })

  it('confirms with real character data on success', async () => {
    const char = makeCharacter()
    const actor = await bootWithUser([char])

    const updated = makeCharacter({ name: 'Server Name', updated_at: '2024-06-01T00:00:00.000Z' })
    mockDb.updateCharacter.mockResolvedValue(updated)

    actor.send({ type: 'UPDATE', id: 'char-1', updates: { name: 'Server Name' } })
    await waitFor(actor, (s) => s.matches('idle'), WAIT_OPTS)

    const snap = actor.getSnapshot()
    expect(snap.context.characters[0]).toEqual(updated)
    expect(snap.context.optimisticSnapshot).toBeNull()
    expect(snap.context.error).toBeNull()
    actor.stop()
  })

  it('rolls back and sets error on failure', async () => {
    const char = makeCharacter()
    const actor = await bootWithUser([char])

    mockDb.updateCharacter.mockRejectedValue(new Error('update failed'))

    actor.send({ type: 'UPDATE', id: 'char-1', updates: { name: 'Bad Update' } })
    await waitFor(actor, (s) => s.matches('idle'), WAIT_OPTS)

    const snap = actor.getSnapshot()
    expect(snap.context.characters).toEqual([char])
    expect(snap.context.optimisticSnapshot).toBeNull()
    expect(snap.context.error).toBeInstanceOf(Error)
    actor.stop()
  })
})

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------
describe('DELETE', () => {
  it('optimistically removes character from list', async () => {
    const char1 = makeCharacter({ id: 'char-1' })
    const char2 = makeCharacter({ id: 'char-2', name: 'Second' })
    const actor = await bootWithUser([char1, char2])

    mockDb.deleteCharacter.mockReturnValue(new Promise(() => {})) // keep pending

    actor.send({ type: 'DELETE', id: 'char-1' })

    const snap = actor.getSnapshot()
    expect(snap.matches('deleting')).toBe(true)
    expect(snap.context.characters).toEqual([char2])
    expect(snap.context.optimisticSnapshot).toEqual([char1, char2])

    actor.stop()
  })

  it('confirms deletion (clears optimisticSnapshot) on success', async () => {
    const char = makeCharacter()
    const actor = await bootWithUser([char])

    mockDb.deleteCharacter.mockResolvedValue(undefined)

    actor.send({ type: 'DELETE', id: 'char-1' })
    await waitFor(actor, (s) => s.matches('idle'), WAIT_OPTS)

    const snap = actor.getSnapshot()
    expect(snap.context.characters).toEqual([])
    expect(snap.context.optimisticSnapshot).toBeNull()
    expect(snap.context.error).toBeNull()
    actor.stop()
  })

  it('rolls back and sets error on failure', async () => {
    const char = makeCharacter()
    const actor = await bootWithUser([char])

    mockDb.deleteCharacter.mockRejectedValue(new Error('delete failed'))

    actor.send({ type: 'DELETE', id: 'char-1' })
    await waitFor(actor, (s) => s.matches('idle'), WAIT_OPTS)

    const snap = actor.getSnapshot()
    expect(snap.context.characters).toEqual([char])
    expect(snap.context.optimisticSnapshot).toBeNull()
    expect(snap.context.error).toBeInstanceOf(Error)
    actor.stop()
  })
})

// ---------------------------------------------------------------------------
// USER_CHANGED
// ---------------------------------------------------------------------------
describe('USER_CHANGED', () => {
  it('resets all context fields and triggers a fresh load', async () => {
    const char = makeCharacter()
    const actor = await bootWithUser([char])

    const newChar = makeCharacter({ id: 'char-new', user_id: 'user-2' })
    mockDb.getUserCharacters.mockResolvedValue([newChar])

    actor.send({ type: 'USER_CHANGED', userId: 'user-2' })
    await waitFor(actor, (s) => s.matches('idle'), WAIT_OPTS)

    const snap = actor.getSnapshot()
    expect(snap.context.userId).toBe('user-2')
    expect(snap.context.characters).toEqual([newChar])
    expect(snap.context.error).toBeNull()
    expect(snap.context.pendingCharacterId).toBeNull()
    expect(snap.context.optimisticSnapshot).toBeNull()
    expect(snap.context.pendingTempId).toBeNull()
    actor.stop()
  })

  it('clears pendingTempId to prevent stale IDs leaking to new session', async () => {
    const char = makeCharacter()
    const actor = await bootWithUser([char])

    // Start a create, hold it pending so pendingTempId is set
    let resolveCreate!: (c: DbCharacter | null) => void
    mockDb.createCharacter.mockReturnValue(
      new Promise<DbCharacter | null>((resolve) => {
        resolveCreate = resolve
      }),
    )
    actor.send({ type: 'CREATE', data: { name: 'In-flight', is_public: false } })
    expect(actor.getSnapshot().context.pendingTempId).toMatch(/^temp-/)

    // Switch user mid-flight — provide a non-empty list so creatingDefault is skipped
    const user2Char = makeCharacter({ id: 'char-u2', user_id: 'user-2' })
    mockDb.getUserCharacters.mockResolvedValue([user2Char])
    actor.send({ type: 'USER_CHANGED', userId: 'user-2' })
    await waitFor(actor, (s) => s.matches('idle'), WAIT_OPTS)

    expect(actor.getSnapshot().context.pendingTempId).toBeNull()

    // Resolve the dangling promise (XState already cancelled the actor)
    resolveCreate(null)
    actor.stop()
  })
})

// ---------------------------------------------------------------------------
// CHARACTERS_SYNCED — scoped to idle only
// ---------------------------------------------------------------------------
describe('CHARACTERS_SYNCED', () => {
  it('updates characters list when received in idle', async () => {
    const char = makeCharacter()
    const actor = await bootWithUser([char])

    const synced = [makeCharacter({ id: 'synced-1', name: 'From Cloud' })]
    actor.send({ type: 'CHARACTERS_SYNCED', characters: synced })

    expect(actor.getSnapshot().context.characters).toEqual(synced)
    actor.stop()
  })

  it('is ignored during an in-flight optimistic operation', async () => {
    const char = makeCharacter()
    const actor = await bootWithUser([char])

    let resolveCreate!: (c: DbCharacter | null) => void
    mockDb.createCharacter.mockReturnValue(
      new Promise<DbCharacter | null>((resolve) => {
        resolveCreate = resolve
      }),
    )

    actor.send({ type: 'CREATE', data: { name: 'In-flight', is_public: false } })
    expect(actor.getSnapshot().matches('creating')).toBe(true)

    const optimisticChars = actor.getSnapshot().context.characters

    // Sync event arrives during creating — must be dropped
    actor.send({
      type: 'CHARACTERS_SYNCED',
      characters: [makeCharacter({ id: 'synced-1', name: 'From Cloud' })],
    })

    // Characters must still reflect the optimistic state
    expect(actor.getSnapshot().context.characters).toEqual(optimisticChars)

    resolveCreate(makeCharacter({ id: 'char-2' }))
    await waitFor(actor, (s) => s.matches('idle'), WAIT_OPTS)
    actor.stop()
  })
})

// ---------------------------------------------------------------------------
// Default character creation
// ---------------------------------------------------------------------------
describe('default character creation', () => {
  it('creates a default character when the loaded list is empty for a real user', async () => {
    mockDb.getUserCharacters.mockResolvedValue([])
    const defaultChar = makeCharacter({ id: 'default-1', name: 'Clanker' })
    mockDb.createCharacter.mockResolvedValue(defaultChar)

    const actor = createActor(characterMachine)
    actor.start()
    // Initial null-user boot → idle
    await waitFor(actor, (s) => s.matches('idle'), WAIT_OPTS)

    actor.send({ type: 'USER_CHANGED', userId: USER_ID })
    // loading → checkingDefault → creatingDefault → idle
    await waitFor(actor, (s) => s.matches('idle'), WAIT_OPTS)

    expect(actor.getSnapshot().context.characters).toEqual([defaultChar])
    actor.stop()
  })

  it('lands in idle with error when default character creation fails', async () => {
    mockDb.getUserCharacters.mockResolvedValue([])
    mockDb.createCharacter.mockRejectedValue(new Error('create failed'))

    const actor = createActor(characterMachine)
    actor.start()
    await waitFor(actor, (s) => s.matches('idle'), WAIT_OPTS)

    actor.send({ type: 'USER_CHANGED', userId: USER_ID })
    await waitFor(actor, (s) => s.matches('idle'), WAIT_OPTS)

    const snap = actor.getSnapshot()
    expect(snap.context.characters).toEqual([])
    expect(snap.context.error).toBeInstanceOf(Error)
    actor.stop()
  })
})
