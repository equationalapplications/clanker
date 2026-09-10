/**
 * Reproduction for: a brand-new user's default "Clanker" shows sync as enabled,
 * but pressing Talk raises "Cloud Sync Required".
 *
 * Every existing test in this area mocks `characterDatabase` wholesale and hands
 * the machine a hand-written character object, so the chain that actually has to
 * hold for the Talk gate is asserted nowhere:
 *
 *   DEFAULT_CHARACTER_INSERT.save_to_cloud: true
 *     -> INSERT ... save_to_cloud = 1
 *     -> SELECT * -> toAppFormat -> save_to_cloud === 1 -> true
 *     -> useLiveVoiceChat.startCall gate
 *
 * This drives the REAL machine and the REAL characterDatabase over an in-memory
 * stand-in for expo-sqlite, then feeds the resulting character straight into the
 * REAL gate. Nothing between the default insert and the alert is faked.
 */
import React from 'react'
import { act, create } from 'react-test-renderer'
import { createActor, waitFor } from 'xstate'

// --- in-memory stand-in for expo-sqlite -------------------------------------
// Columns are zipped from the INSERT's own column list, so a column/value
// ordering bug in createCharacter would surface here rather than be papered
// over by a hand-written fixture.
type Row = Record<string, unknown>
const mockRows: Row[] = []

function mockParseInsertColumns(sql: string): string[] {
  const match = sql.match(/INSERT\s+INTO\s+characters\s*\(([^)]+)\)/i)
  if (!match) throw new Error(`Unrecognized INSERT: ${sql}`)
  return match[1].split(',').map((c) => c.trim())
}

const mockDatabase = {
  runAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
    if (/INSERT\s+INTO\s+characters/i.test(sql)) {
      const columns = mockParseInsertColumns(sql)
      const row: Row = {}
      columns.forEach((column, index) => {
        row[column] = params[index]
      })
      mockRows.push(row)
    }
    return { changes: 1, lastInsertRowId: mockRows.length }
  }),
  getFirstAsync: jest.fn(async (_sql: string, params: unknown[] = []) => {
    return mockRows.find((row) => row.id === params[0]) ?? null
  }),
  getAllAsync: jest.fn(async (_sql: string, params: unknown[] = []) => {
    return mockRows.filter((row) => row.user_id === params[0] && !row.deleted_at)
  }),
  withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => fn()),
}

jest.mock('../src/database/index', () => ({
  getDatabase: async () => mockDatabase,
}))

// The flag that hides this bug on a local machine: with EXPO_PUBLIC_USE_MOCK_AUTH=true
// the machine takes the ensureDevSandboxCharacter branch, which hands back a
// character that is already cloud_id'd and synced. Force the real path.
jest.mock('../src/auth/devSandboxFlag', () => ({ isDevSandboxEnabled: () => false }))

// Leaf mock only: expo-crypto pulls the whole expo-constants native chain into
// Jest, which the react-native mock below cannot satisfy. The uuid value is
// irrelevant to what this test asserts.
jest.mock('../src/utilities/generateSecureUuid', () => ({
  generateSecureUuid: () => '11111111-1111-4111-8111-111111111111',
}))

jest.mock('../src/services/characterSyncService', () => ({
  syncAllToCloud: jest.fn().mockResolvedValue(undefined),
  restoreFromCloud: jest.fn().mockResolvedValue(undefined),
  removeCharacterFromCloud: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../src/services/characterImageSyncService', () => ({
  promoteCharacterImagesToCloud: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../src/services/wikiOrchestrator', () => ({ wikiOrchestrator: { stop: jest.fn() } }))
jest.mock('../src/services/wikiService', () => ({
  setupWiki: jest.fn(),
  getWiki: jest.fn(),
  initWiki: jest.fn().mockResolvedValue(undefined),
  _resetWikiForTests: jest.fn(),
}))

// --- Talk-gate harness (mirrors __tests__/useLiveVoiceChat.test.tsx) ---------
const mockRouterPush = jest.fn()
const mockUseCharacter = jest.fn()
const mockUseSelector = jest.fn()
const mockUseCurrentPlan = jest.fn()
const mockStartRecording = jest.fn()
const mockSend = jest.fn()
const mockUseMachine = jest.fn()

jest.mock('~/machines/liveVoiceMachine', () => {
  const machine = { id: 'liveVoiceMachine', provide: jest.fn() }
  machine.provide.mockReturnValue(machine)
  return { liveVoiceMachine: machine }
})
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockRouterPush(...a) } }))
jest.mock('expo-router/react-navigation', () => ({
  useNavigation: () => ({ addListener: jest.fn().mockReturnValue(jest.fn()) }),
}))
const mockRetrySync = jest.fn()
jest.mock('~/hooks/useCharacters', () => ({
  useCharacter: (...a: unknown[]) => mockUseCharacter(...a),
  useSyncCharacters: () => ({ sync: mockRetrySync, isCloudSyncing: false, error: null }),
}))
jest.mock('~/hooks/useMachines', () => ({ useAuthMachine: () => ({ send: jest.fn() }) }))
jest.mock('~/hooks/useCurrentPlan', () => ({
  useCurrentPlan: (...a: unknown[]) => mockUseCurrentPlan(...a),
}))
jest.mock('@xstate/react', () => ({
  useSelector: (...a: unknown[]) => mockUseSelector(...a),
  useMachine: (...a: unknown[]) => mockUseMachine(...a),
}))
jest.mock('~/hooks/useLiveAudioIO', () => ({
  useLiveAudioIO: () => ({
    recordingState: 'idle',
    playbackState: 'idle',
    error: null,
    startRecording: mockStartRecording,
    stopRecording: jest.fn(),
    playChunk: jest.fn(),
    clearPlaybackQueue: jest.fn(),
    onAudioChunk: jest.fn().mockReturnValue(() => {}),
  }),
}))
jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
  AppState: { addEventListener: jest.fn().mockReturnValue({ remove: jest.fn() }) },
  Platform: { OS: 'ios' },
}))

import { Alert } from 'react-native'
import { characterMachine } from '../src/machines/characterMachine'
import type { Character } from '../src/services/characterService'
import { useLiveVoiceChat } from '~/hooks/useLiveVoiceChat'

const USER_ID = 'user-fresh-signup'
const CLOUD_ID = '33333333-3333-4333-8333-333333333333'
const WAIT_OPTS = { timeout: 2000 }

function TestHarness({
  characterId,
  onMount,
}: {
  characterId: string
  onMount: (hook: ReturnType<typeof useLiveVoiceChat>) => void
}) {
  const hook = useLiveVoiceChat(characterId)
  React.useEffect(() => {
    onMount(hook)
  })
  return null
}

/** Mirrors markCharacterSynced: the server returns an id, which is written back. */
function completeCloudSync() {
  const { syncAllToCloud } = jest.requireMock('../src/services/characterSyncService')
  syncAllToCloud.mockImplementation(async () => {
    mockRows.forEach((row) => {
      if (row.save_to_cloud === 1) {
        row.cloud_id = CLOUD_ID
        row.synced_to_cloud = 1
      }
    })
  })
}

async function pressTalk(character: Character) {
  mockUseCharacter.mockReturnValue({ data: character })
  let hookRef: ReturnType<typeof useLiveVoiceChat> | null = null
  await act(async () => {
    create(
      <TestHarness
        characterId={character.id}
        onMount={(h) => {
          hookRef = h
        }}
      />,
    )
  })
  await act(async () => {
    await hookRef!.startCall()
  })
}

/** Fresh signup: empty local DB, real machine, real characterDatabase. */
async function mintDefaultCharacter() {
  const actor = createActor(characterMachine)
  actor.start()
  await waitFor(actor, (s) => s.matches('idle'), WAIT_OPTS)
  actor.send({ type: 'USER_CHANGED', userId: USER_ID })
  await waitFor(actor, (s) => s.matches('idle'), WAIT_OPTS)
  const character = actor.getSnapshot().context.characters[0]
  actor.stop()
  return character
}

beforeEach(() => {
  mockRows.length = 0
  jest.clearAllMocks()
  // clearAllMocks keeps installed implementations, so a persistent mockImplementation
  // (completeCloudSync) or an unconsumed mockRejectedValueOnce would leak across
  // tests and make this suite order-dependent. Reset the sync mock to its
  // module default each time. The mockDatabase stand-ins keep their inline
  // implementations by design, so resetAllMocks would strip those instead.
  const { syncAllToCloud } = jest.requireMock('../src/services/characterSyncService')
  syncAllToCloud.mockReset()
  syncAllToCloud.mockResolvedValue(undefined)
  mockUseSelector.mockReturnValue({ uid: USER_ID })
  mockUseCurrentPlan.mockReturnValue({ remainingCredits: 5000 })
  mockUseMachine.mockReturnValue([
    { matches: () => false, context: { transcript: [], remainingCredits: 5000 } },
    mockSend,
  ])
  mockStartRecording.mockResolvedValue(true)
})

describe('default character -> Talk gate', () => {
  it('persists save_to_cloud through the real insert/read round trip', async () => {
    const character = await mintDefaultCharacter()

    expect(character).toBeDefined()
    expect(character.name).toBe('Clanker')
    // What the row actually holds on disk.
    expect(mockRows[0].save_to_cloud).toBe(1)
    // What toAppFormat hands the UI and the gate.
    expect(character.save_to_cloud).toBe(true)
    // Not yet confirmed-synced: cloud_id only lands once syncCharacter returns an
    // id and markCharacterSynced runs. This is exactly the state commit 79fed5b3
    // describes as "save_to_cloud enabled but no cloud_id".
    expect(character.cloud_id).toBeNull()
  })

  it('clears the Talk gate once the first cloud sync has landed', async () => {
    completeCloudSync()
    const character = await mintDefaultCharacter()

    expect(character.cloud_id).toBe(CLOUD_ID)

    await pressTalk(character)

    expect(Alert.alert).not.toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledWith({ type: 'START_CALL' })
  })

  it('blocks Talk when sync was requested but never landed', async () => {
    const { syncAllToCloud } = jest.requireMock('../src/services/characterSyncService')
    syncAllToCloud.mockRejectedValueOnce(new Error('network down'))

    const character = await mintDefaultCharacter()
    // The reported state: the toggle reads as on, but no cloud record exists.
    expect(character.save_to_cloud).toBe(true)
    expect(character.cloud_id).toBeNull()

    await pressTalk(character)

    // Not "Cloud Sync Required" -- that wording sent users to a toggle that was
    // already correct. The blocker is the incomplete sync, so say so.
    expect(Alert.alert).toHaveBeenCalledWith(
      'Finishing Cloud Sync',
      expect.any(String),
      expect.any(Array),
    )
    expect(mockSend).not.toHaveBeenCalledWith({ type: 'START_CALL' })
  })

  it('offers a sync retry rather than a trip to the already-correct toggle', async () => {
    const { syncAllToCloud } = jest.requireMock('../src/services/characterSyncService')
    syncAllToCloud.mockRejectedValueOnce(new Error('network down'))

    const character = await mintDefaultCharacter()
    await pressTalk(character)

    const actions = (Alert.alert as jest.Mock).mock.calls[0][2] as {
      text: string
      onPress?: () => void
    }[]
    const retry = actions.find((action) => action.text === 'Retry Sync')
    expect(retry).toBeDefined()

    retry!.onPress!()
    expect(mockRetrySync).toHaveBeenCalled()
    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it('still points at character settings when sync is genuinely switched off', async () => {
    completeCloudSync()
    const character = await mintDefaultCharacter()

    await pressTalk({ ...character, save_to_cloud: false })

    expect(Alert.alert).toHaveBeenCalledWith(
      'Cloud Sync Required',
      expect.any(String),
      expect.any(Array),
    )
    const actions = (Alert.alert as jest.Mock).mock.calls[0][2] as {
      text: string
      onPress?: () => void
    }[]
    actions.find((action) => action.text === 'Enable Sync')!.onPress!()
    expect(mockRouterPush).toHaveBeenCalledWith(`/characters/${character.id}/edit`)
  })
})
