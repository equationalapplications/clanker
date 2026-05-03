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

const mockGetWiki = jest.fn(() => ({
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
  })

  it('exports with local id and sends cloud UUID as entity key', async () => {
    const char = makeCloudChar()
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([char])
    mockExportDump.mockResolvedValue({
      generatedAt: 1000,
      entities: { [LOCAL_ID]: { facts: [{ id: 'f1', title: 'fact', body: 'b' }], tasks: [], events: [] } },
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

  it('skips character entirely when wiki is unavailable (web/uninitialized)', async () => {
    mockGetWiki.mockReturnValueOnce(null)
    const char = makeCloudChar()
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([char])

    await syncAllToCloud('user-1')

    expect(mockExportDump).not.toHaveBeenCalled()
    expect(mockImportDump).not.toHaveBeenCalled()
    expect(mockRunPrune).not.toHaveBeenCalled()
    expect(mockWikiSyncFn).not.toHaveBeenCalled()
  })
})
