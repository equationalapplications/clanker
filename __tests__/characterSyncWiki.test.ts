/**
 * Unit tests for syncWikiForCloud entity key remapping in characterSyncService.
 *
 * Tests that:
 * - The local char.id is used when exporting from the local wiki
 * - The cloud UUID (cloud_id) is used as the entity key when calling wikiSyncFn
 * - The response is remapped back to char.id before importDump
 * - WikiBusyError from importDump does NOT prevent runPrune
 */

// --- Mocks ---

const mockExportDump = jest.fn()
const mockImportDump = jest.fn()
const mockRunPrune = jest.fn()
const mockGetEntityStatus = jest.fn().mockReturnValue({ ingesting: false, librarian: false })

type MockWiki = { exportDump: jest.Mock; importDump: jest.Mock; runPrune: jest.Mock; getEntityStatus: jest.Mock }
const mockGetWiki = jest.fn<MockWiki | null, []>(() => ({
  exportDump: mockExportDump,
  importDump: mockImportDump,
  runPrune: mockRunPrune,
  getEntityStatus: mockGetEntityStatus,
}))

jest.mock('~/services/wikiService', () => ({
  getWiki: () => mockGetWiki(),
}))

const mockWikiSyncFn = jest.fn()
jest.mock('~/config/firebaseConfig', () => ({
  getCurrentUser: jest.fn(() => ({ uid: 'user-1' })),
  appCheckReady: Promise.resolve(),
}))

const mockGetAllCharactersIncludingDeleted = jest.fn()
const mockGetUnsyncedCharacters = jest.fn().mockResolvedValue([])
const mockGetSoftDeletedCharacters = jest.fn().mockResolvedValue([])

jest.mock('../src/database/characterDatabase', () => ({
  getAllCharactersIncludingDeleted: (...args: unknown[]) =>
    mockGetAllCharactersIncludingDeleted(...args),
  getUnsyncedCharacters: (...args: unknown[]) => mockGetUnsyncedCharacters(...args),
  getSoftDeletedCharacters: (...args: unknown[]) => mockGetSoftDeletedCharacters(...args),
  markCharacterSynced: jest.fn(),
  hardDeleteCharacterLocal: jest.fn(),
  batchInsertCharacters: jest.fn(),
  clearCharacterCloudLink: jest.fn(),
  getCharacter: jest.fn(),
}))

jest.mock('~/utilities/kvStorage', () => ({
  Storage: { getItem: jest.fn(), setItem: jest.fn() },
}))
jest.mock('~/utilities/reportError', () => ({ reportError: jest.fn() }))
jest.mock('./apiClient', () => ({}), { virtual: true })
jest.mock('~/services/apiClient', () => ({
  syncCharacterFn: jest.fn(),
  deleteCharacterFn: jest.fn(),
  getUserCharactersFn: jest.fn(),
  getPublicCharacterFn: jest.fn(),
  wikiSync: (...args: unknown[]) => mockWikiSyncFn(...args),
}))

// WikiBusyError is loaded via jest.requireActual in the
// 'still runs runPrune when importDump throws WikiBusyError' test.

// Import after mocks
import { syncAllToCloud } from '../src/services/characterSyncService'
import { reportError } from '~/utilities/reportError'

// --- Helpers ---

function makeCloudChar(overrides: Record<string, unknown> = {}) {
  return {
    id: 'char-local-1',
    user_id: 'user-1',
    cloud_id: '550e8400-e29b-41d4-a716-446655440000',
    save_to_cloud: 1,
    deleted_at: null,
    name: 'Test',
    avatar: null,
    avatar_data: null,
    avatar_mime_type: null,
    appearance: null,
    traits: null,
    emotions: null,
    context: null,
    is_public: 0,
    created_at: 1000,
    updated_at: 2000,
    synced_to_cloud: 1,
    summary_checkpoint: 0,
    owner_user_id: 'user-1',
    voice: null,
    ...overrides,
  }
}

const CLOUD_ID = '550e8400-e29b-41d4-a716-446655440000'
const LOCAL_ID = 'char-local-1'

// --- Tests ---

describe('syncWikiForCloud key remapping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetWiki.mockImplementation(() => ({
      exportDump: mockExportDump,
      importDump: mockImportDump,
      runPrune: mockRunPrune,
      getEntityStatus: mockGetEntityStatus,
    }))
  })

  it('exports with local id and sends cloud UUID as entity key', async () => {
    const char = makeCloudChar()
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([char])
    mockExportDump.mockResolvedValue({
      generatedAt: 1000,
      entities: {
        [LOCAL_ID]: {
          facts: [
            {
              id: 'f1',
              entity_id: LOCAL_ID,
              title: 'fact',
              body: 'b',
              confidence: 'inferred',
              tags: [],
              source_type: 'agent_inferred',
              created_at: 1000,
              updated_at: 1000,
            },
          ],
          tasks: [
            {
              id: 't1',
              entity_id: LOCAL_ID,
              description: 'task',
              status: 'pending',
              priority: 1,
              created_at: 1000,
              updated_at: 1000,
            },
          ],
          events: [
            {
              id: 'e1',
              entity_id: LOCAL_ID,
              event_type: 'observation',
              summary: 'event',
              created_at: 1000,
            },
          ],
        },
      },
    })
    mockWikiSyncFn.mockResolvedValue({
      data: {
        remoteDump: {
          generatedAt: 1001,
          entities: { [CLOUD_ID]: { facts: [], tasks: [], events: [] } },
        },
      },
    })
    mockImportDump.mockResolvedValue(undefined)
    mockRunPrune.mockResolvedValue(undefined)

    await syncAllToCloud('user-1')

    // exportDump called with local id
    expect(mockExportDump).toHaveBeenCalledWith([LOCAL_ID])

    // wikiSyncFn called with cloud UUID as entity key
    const syncArg = mockWikiSyncFn.mock.calls[0][0]
    expect(Object.keys(syncArg.dump.entities)).toEqual([CLOUD_ID])
    expect(Object.keys(syncArg.dump.entities)).not.toContain(LOCAL_ID)
    expect(syncArg.dump.entities[CLOUD_ID]).toEqual({
      facts: [expect.objectContaining({ id: 'f1', entity_id: CLOUD_ID })],
      tasks: [expect.objectContaining({ id: 't1', entity_id: CLOUD_ID })],
      events: [expect.objectContaining({ id: 'e1', entity_id: CLOUD_ID })],
    })
  })

  it('remaps remoteDump back to local id before importDump', async () => {
    const char = makeCloudChar()
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([char])
    mockExportDump.mockResolvedValue({
      generatedAt: 1000,
      entities: { [LOCAL_ID]: { facts: [], tasks: [], events: [] } },
    })
    const remoteFacts = [{ id: 'rf1', title: 'remote', body: 'rb' }]
    mockWikiSyncFn.mockResolvedValue({
      data: {
        remoteDump: {
          generatedAt: 1001,
          entities: { [CLOUD_ID]: { facts: remoteFacts, tasks: [], events: [] } },
        },
      },
    })
    mockImportDump.mockResolvedValue(undefined)
    mockRunPrune.mockResolvedValue(undefined)

    await syncAllToCloud('user-1')

    // importDump called with local id as entity key
    expect(mockImportDump).toHaveBeenCalledWith(
      expect.objectContaining({
        entities: expect.objectContaining({
          [LOCAL_ID]: expect.objectContaining({ facts: remoteFacts }),
        }),
      }),
      { merge: true },
    )
    // cloud UUID must NOT appear as entity key
    const importArg = mockImportDump.mock.calls[0][0]
    expect(Object.keys(importArg.entities)).not.toContain(CLOUD_ID)
  })

  it('still runs runPrune when importDump throws WikiBusyError', async () => {
    const { WikiBusyError } = jest.requireActual<typeof import('@equationalapplications/expo-llm-wiki')>(
      '@equationalapplications/expo-llm-wiki',
    )
    const char = makeCloudChar()
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([char])
    mockExportDump.mockResolvedValue({
      generatedAt: 1000,
      entities: { [LOCAL_ID]: { facts: [], tasks: [], events: [] } },
    })
    mockWikiSyncFn.mockResolvedValue({
      data: { remoteDump: { generatedAt: 1001, entities: { [CLOUD_ID]: { facts: [], tasks: [], events: [] } } } },
    })
    mockImportDump.mockRejectedValue(new WikiBusyError('ingest', LOCAL_ID))
    mockRunPrune.mockResolvedValue(undefined)

    await syncAllToCloud('user-1')

    // WikiBusyError from importDump should not prevent runPrune
    expect(mockRunPrune).toHaveBeenCalledWith(LOCAL_ID, expect.any(Object))
    expect(reportError).not.toHaveBeenCalled()
  })

  it('does NOT run runPrune when wikiSyncFn throws', async () => {
    const char = makeCloudChar()
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([char])
    mockExportDump.mockResolvedValue({
      generatedAt: 1000,
      entities: { [LOCAL_ID]: { facts: [], tasks: [], events: [] } },
    })
    mockWikiSyncFn.mockRejectedValue(new Error('network error'))

    await syncAllToCloud('user-1')

    expect(mockRunPrune).not.toHaveBeenCalled()
  })

  it('skips all characters when wiki is unavailable (web/uninitialized)', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    mockGetWiki.mockReturnValue(null)
    const char = makeCloudChar()
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([char])

    await syncAllToCloud('user-1')

    expect(mockExportDump).not.toHaveBeenCalled()
    expect(mockImportDump).not.toHaveBeenCalled()
    expect(mockRunPrune).not.toHaveBeenCalled()
    expect(mockWikiSyncFn).not.toHaveBeenCalled()
    expect(reportError).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      '[syncWikiForCloud] wiki unavailable — skipping wiki sync for all characters',
    )
    warnSpy.mockRestore()
  })

  it('reports non-busy sync errors with wiki:sync context', async () => {
    const char = makeCloudChar()
    const syncErr = new Error('network error')
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([char])
    mockExportDump.mockResolvedValue({
      generatedAt: 1000,
      entities: { [LOCAL_ID]: { facts: [], tasks: [], events: [] } },
    })
    mockWikiSyncFn.mockRejectedValue(syncErr)

    await syncAllToCloud('user-1')

    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(`Wiki cloud sync (character ${LOCAL_ID})`),
        cause: syncErr,
      }),
      'wiki:sync',
    )
  })

  it('does not call reportError when wikiSyncFn rejects with WikiBusyError', async () => {
    const { WikiBusyError } = jest.requireActual<typeof import('@equationalapplications/expo-llm-wiki')>(
      '@equationalapplications/expo-llm-wiki',
    )
    const char = makeCloudChar()
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([char])
    mockExportDump.mockResolvedValue({
      generatedAt: 1000,
      entities: { [LOCAL_ID]: { facts: [], tasks: [], events: [] } },
    })
    mockWikiSyncFn.mockRejectedValue(new WikiBusyError('ingest', LOCAL_ID))

    await syncAllToCloud('user-1')

    expect(reportError).not.toHaveBeenCalled()
  })

  it('reports non-busy export errors with wiki:export context and skips WikiBusyError', async () => {
    const { WikiBusyError } = jest.requireActual<typeof import('@equationalapplications/expo-llm-wiki')>(
      '@equationalapplications/expo-llm-wiki',
    )
    const char = makeCloudChar()
    const exportErr = new Error('export failed')
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([char])
    mockExportDump.mockRejectedValueOnce(exportErr).mockRejectedValueOnce(new WikiBusyError('ingest', LOCAL_ID))

    await syncAllToCloud('user-1')
    await syncAllToCloud('user-1')

    expect(reportError).toHaveBeenCalledTimes(1)
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(`Wiki export (character ${LOCAL_ID})`),
        cause: exportErr,
      }),
      'wiki:export',
    )
    expect(mockWikiSyncFn).not.toHaveBeenCalled()
  })

  it('reports non-busy import errors with wiki:import context', async () => {
    const char = makeCloudChar()
    const importErr = new Error('import failed')
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([char])
    mockExportDump.mockResolvedValue({
      generatedAt: 1000,
      entities: { [LOCAL_ID]: { facts: [], tasks: [], events: [] } },
    })
    mockWikiSyncFn.mockResolvedValue({
      data: { remoteDump: { generatedAt: 1001, entities: { [CLOUD_ID]: { facts: [], tasks: [], events: [] } } } },
    })
    mockImportDump.mockRejectedValue(importErr)

    await syncAllToCloud('user-1')

    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(`Wiki import (character ${LOCAL_ID})`),
        cause: importErr,
      }),
      'wiki:import',
    )
    expect(mockRunPrune).not.toHaveBeenCalled()
  })

  it('reports non-busy prune errors with wiki:prune context and skips WikiBusyError', async () => {
    const { WikiBusyError } = jest.requireActual<typeof import('@equationalapplications/expo-llm-wiki')>(
      '@equationalapplications/expo-llm-wiki',
    )
    const char = makeCloudChar()
    const pruneErr = new Error('prune failed')
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([char])
    mockExportDump.mockResolvedValue({
      generatedAt: 1000,
      entities: { [LOCAL_ID]: { facts: [], tasks: [], events: [] } },
    })
    mockWikiSyncFn.mockResolvedValue({
      data: { remoteDump: { generatedAt: 1001, entities: { [CLOUD_ID]: { facts: [], tasks: [], events: [] } } } },
    })
    mockImportDump.mockResolvedValue(undefined)
    mockRunPrune.mockRejectedValueOnce(pruneErr).mockRejectedValueOnce(new WikiBusyError('ingest', LOCAL_ID))

    await syncAllToCloud('user-1')
    await syncAllToCloud('user-1')

    expect(reportError).toHaveBeenCalledTimes(1)
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(`Wiki prune (character ${LOCAL_ID})`),
        cause: pruneErr,
      }),
      'wiki:prune',
    )
  })
})
