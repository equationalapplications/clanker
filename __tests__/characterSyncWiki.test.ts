const mockGetWiki = jest.fn(() => ({}))
const mockWikiSyncFn = jest.fn()
const mockSyncAll = jest.fn()
const mockGetAllCharactersIncludingDeleted = jest.fn()
const mockGetUnsyncedCharacters = jest.fn().mockResolvedValue([])
const mockGetSoftDeletedCharacters = jest.fn().mockResolvedValue([])

jest.mock('~/services/wikiService', () => ({
  getWiki: () => mockGetWiki(),
}))

jest.mock('~/services/wikiOrchestrator', () => ({
  wikiOrchestrator: {
    syncAll: (...args: unknown[]) => mockSyncAll(...args),
  },
}))

jest.mock('~/config/firebaseConfig', () => ({
  getCurrentUser: jest.fn(() => ({ uid: 'user-1' })),
  appCheckReady: Promise.resolve(),
}))

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
jest.mock('~/services/apiClient', () => ({
  syncCharacterFn: jest.fn(),
  deleteCharacterFn: jest.fn(),
  getUserCharactersFn: jest.fn(),
  getPublicCharacterFn: jest.fn(),
  wikiSync: (...args: unknown[]) => mockWikiSyncFn(...args),
}))

import { syncAllToCloud } from '../src/services/characterSyncService'
import { reportError } from '~/utilities/reportError'

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

describe('syncWikiForCloud orchestration path', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetWiki.mockReturnValue({})
    mockSyncAll.mockResolvedValue(undefined)
  })

  it('routes sync through wikiOrchestrator.syncAll', async () => {
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([makeCloudChar()])

    await syncAllToCloud('user-1')

    expect(mockSyncAll).toHaveBeenCalledTimes(1)
    const [itemsArg, wikiArg, concurrencyArg] = mockSyncAll.mock.calls[0]
    expect(wikiArg).toEqual({})
    expect(concurrencyArg).toBe(1)
    expect(itemsArg).toHaveLength(1)
    expect(itemsArg[0].entityId).toBe(LOCAL_ID)
  })

  it('remaps local->cloud and cloud->local within runRemoteSync callback', async () => {
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([makeCloudChar()])
    await syncAllToCloud('user-1')

    const [itemsArg] = mockSyncAll.mock.calls[0]
    const runRemoteSync = itemsArg[0].runRemoteSync as (dump: any) => Promise<any>
    mockWikiSyncFn.mockResolvedValue({
      data: {
        remoteDump: {
          generatedAt: 1001,
          entities: { [CLOUD_ID]: { facts: [{ id: 'rf1' }], tasks: [], events: [] } },
        },
      },
    })

    const remapped = await runRemoteSync({
      generatedAt: 1000,
      entities: { [LOCAL_ID]: { facts: [{ id: 'f1', entity_id: LOCAL_ID }], tasks: [], events: [] } },
    })

    const syncArg = mockWikiSyncFn.mock.calls[0][0]
    expect(Object.keys(syncArg.dump.entities)).toEqual([CLOUD_ID])
    expect(Object.keys(remapped.entities)).toEqual([LOCAL_ID])
    expect(remapped.entities[LOCAL_ID].facts).toEqual([{ id: 'rf1' }])
  })

  it('continues fail-soft when orchestrator sync throws', async () => {
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([makeCloudChar()])
    mockSyncAll.mockRejectedValue(new Error('network error'))

    await expect(syncAllToCloud('user-1')).resolves.toBeUndefined()
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining(`Wiki cloud sync (character ${LOCAL_ID})`) }),
      'wiki:sync',
    )
  })
})
