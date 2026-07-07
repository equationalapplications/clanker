const mockGetUnsyncedCharacters = jest.fn()
const mockGetSoftDeletedCharacters = jest.fn().mockResolvedValue([])
const mockGetAllCharactersIncludingDeleted = jest.fn().mockResolvedValue([])
const mockMarkCharacterSynced = jest.fn()
const mockSetPendingCloudIdIfMissing = jest.fn()
const mockSyncCharacterFn = jest.fn()

jest.mock('~/config/firebaseConfig', () => ({
  getCurrentUser: jest.fn(() => ({ uid: 'user-1' })),
  appCheckReady: Promise.resolve(),
}))

jest.mock('../src/database/characterDatabase', () => ({
  getAllCharactersIncludingDeleted: (...args: unknown[]) =>
    mockGetAllCharactersIncludingDeleted(...args),
  getUnsyncedCharacters: (...args: unknown[]) => mockGetUnsyncedCharacters(...args),
  getSoftDeletedCharacters: (...args: unknown[]) => mockGetSoftDeletedCharacters(...args),
  markCharacterSynced: (...args: unknown[]) => mockMarkCharacterSynced(...args),
  setPendingCloudIdIfMissing: (...args: unknown[]) => mockSetPendingCloudIdIfMissing(...args),
  hardDeleteCharacterLocal: jest.fn(),
  batchInsertCharacters: jest.fn(),
  clearCharacterCloudLink: jest.fn(),
  getCharacter: jest.fn(),
}))

jest.mock('~/utilities/kvStorage', () => ({
  Storage: { getItem: jest.fn(), setItem: jest.fn() },
}))
jest.mock('~/utilities/reportError', () => ({ reportError: jest.fn() }))
jest.mock('~/auth/devSandboxFlag', () => ({
  isDevSandboxEnabled: jest.fn(() => false),
}))
jest.mock('~/services/wikiService', () => ({ getWiki: jest.fn(() => null) }))
jest.mock('~/services/wikiOrchestrator', () => ({ wikiOrchestrator: { syncAll: jest.fn() } }))
jest.mock('~/services/apiClient', () => ({
  syncCharacterFn: (...args: unknown[]) => mockSyncCharacterFn(...args),
  deleteCharacterFn: jest.fn(),
  getUserCharactersFn: jest.fn(),
  getPublicCharacterFn: jest.fn(),
  wikiSync: jest.fn(),
}))

import { syncAllToCloud } from '../src/services/characterSyncService'

function makeUnsyncedChar(overrides: Record<string, unknown> = {}) {
  return {
    id: 'char-local-1',
    user_id: 'user-1',
    name: 'Clanker',
    avatar: null,
    appearance: null,
    traits: null,
    emotions: null,
    context: null,
    voice: 'Umbriel',
    is_public: false,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    synced_to_cloud: false,
    save_to_cloud: true,
    cloud_id: null,
    pending_cloud_id: null,
    ...overrides,
  }
}

describe('syncUnsyncedToCloud idempotent upload id', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetSoftDeletedCharacters.mockResolvedValue([])
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([])
  })

  it('generates and persists a pending_cloud_id, then sends it as the upload id', async () => {
    mockGetUnsyncedCharacters.mockResolvedValue([makeUnsyncedChar()])
    mockSyncCharacterFn.mockResolvedValue({ data: null }) // simulate a dropped/failed response

    await syncAllToCloud('user-1')

    expect(mockSetPendingCloudIdIfMissing).toHaveBeenCalledTimes(1)
    const [charId, generatedId] = mockSetPendingCloudIdIfMissing.mock.calls[0]
    expect(charId).toBe('char-local-1')
    expect(typeof generatedId).toBe('string')

    expect(mockSyncCharacterFn).toHaveBeenCalledTimes(1)
    const payload = mockSyncCharacterFn.mock.calls[0][0]
    expect(payload.character.id).toBe(generatedId)
  })

  it('reuses the same pending_cloud_id on a retry after a dropped response', async () => {
    const pendingId = '11111111-1111-4111-8111-111111111111'
    mockGetUnsyncedCharacters.mockResolvedValue([
      makeUnsyncedChar({ pending_cloud_id: pendingId }),
    ])
    mockSyncCharacterFn.mockResolvedValue({ data: null })

    await syncAllToCloud('user-1')

    // Already had a pending id — no new one generated or persisted.
    expect(mockSetPendingCloudIdIfMissing).not.toHaveBeenCalled()
    expect(mockSyncCharacterFn).toHaveBeenCalledTimes(1)
    expect(mockSyncCharacterFn.mock.calls[0][0].character.id).toBe(pendingId)

    await syncAllToCloud('user-1')
    expect(mockSyncCharacterFn).toHaveBeenCalledTimes(2)
    expect(mockSyncCharacterFn.mock.calls[1][0].character.id).toBe(pendingId)
  })

  it('prefers a confirmed cloud_id over pending_cloud_id once synced', async () => {
    const cloudId = '22222222-2222-4222-8222-222222222222'
    mockGetUnsyncedCharacters.mockResolvedValue([
      makeUnsyncedChar({
        cloud_id: cloudId,
        pending_cloud_id: '33333333-3333-4333-8333-333333333333',
        synced_to_cloud: false, // e.g. renamed locally after a prior successful sync
      }),
    ])
    mockSyncCharacterFn.mockResolvedValue({ data: { id: cloudId } })

    await syncAllToCloud('user-1')

    expect(mockSyncCharacterFn.mock.calls[0][0].character.id).toBe(cloudId)
    expect(mockMarkCharacterSynced).toHaveBeenCalledWith('char-local-1', cloudId)
  })
})
