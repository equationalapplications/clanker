jest.mock('~/utilities/reportError', () => ({ reportError: jest.fn() }))
jest.mock('~/services/wikiService', () => ({ getWiki: jest.fn() }))
jest.mock('~/services/wikiOrchestrator', () => ({
  wikiOrchestrator: {
    syncAll: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('~/services/apiClient', () => ({
  syncCharacterFn: jest.fn().mockResolvedValue({ data: { id: 'cloud-1' } }),
  deleteCharacterFn: jest.fn().mockResolvedValue({}),
  getUserCharactersFn: jest.fn().mockResolvedValue({ data: { characters: [] } }),
  getPublicCharacterFn: jest.fn().mockResolvedValue({ data: null }),
  wikiSync: jest.fn(),
}))
jest.mock('~/config/firebaseConfig', () => ({
  getCurrentUser: jest.fn(() => ({ uid: 'user1' })),
}))
jest.mock('~/database/characterDatabase', () => ({
  getUnsyncedCharacters: jest.fn().mockResolvedValue([]),
  getSoftDeletedCharacters: jest.fn().mockResolvedValue([]),
  getAllCharactersIncludingDeleted: jest.fn().mockResolvedValue([]),
  markCharacterSynced: jest.fn(),
  hardDeleteCharacterLocal: jest.fn(),
  batchInsertCharacters: jest.fn(),
  clearCharacterCloudLink: jest.fn(),
  getCharacter: jest.fn(),
}))
jest.mock('~/utilities/kvStorage', () => ({
  Storage: { getItem: jest.fn(), setItem: jest.fn() },
}))
jest.mock('~/constants/voiceDefaults', () => ({
  normalizeVoice: jest.fn((v: string) => v),
}))

import { syncAllToCloud } from '~/services/characterSyncService'
import { getWiki } from '~/services/wikiService'
import { wikiOrchestrator } from '~/services/wikiOrchestrator'
import { getAllCharactersIncludingDeleted } from '~/database/characterDatabase'

const UUID = '550e8400-e29b-41d4-a716-446655440000'

describe('syncWikiForCloud via syncAllToCloud', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('calls syncAll once with concurrency=2 for all cloud-linked characters', async () => {
    const fakeWiki = { name: 'fakeWiki' }
    jest.mocked(getWiki).mockReturnValue(fakeWiki as never)
    jest.mocked(getAllCharactersIncludingDeleted).mockResolvedValue([
      { id: 'c1', save_to_cloud: true, cloud_id: UUID, deleted_at: null } as never,
      { id: 'c2', save_to_cloud: true, cloud_id: UUID.replace('550e', '660f'), deleted_at: null } as never,
      { id: 'c3', save_to_cloud: false, cloud_id: null, deleted_at: null } as never,
    ])

    await syncAllToCloud('user1')

    expect(wikiOrchestrator.syncAll).toHaveBeenCalledTimes(1)
    const [items, wiki, concurrency] = jest.mocked(wikiOrchestrator.syncAll).mock.calls[0]
    expect(items).toHaveLength(2)
    expect(items[0].entityId).toBe('c1')
    expect(items[1].entityId).toBe('c2')
    expect(wiki).toBe(fakeWiki)
    expect(concurrency).toBe(2)
  })

  test('skips syncAll when no cloud-linked characters exist', async () => {
    jest.mocked(getWiki).mockReturnValue({ name: 'fakeWiki' } as never)
    jest.mocked(getAllCharactersIncludingDeleted).mockResolvedValue([
      { id: 'c1', save_to_cloud: false, cloud_id: null, deleted_at: null } as never,
    ])

    await syncAllToCloud('user1')

    expect(wikiOrchestrator.syncAll).not.toHaveBeenCalled()
  })

  test('swallows WikiBusyError from syncAll without reporting', async () => {
    const { WikiBusyError } = jest.requireActual('@equationalapplications/expo-llm-wiki')
    jest.mocked(getWiki).mockReturnValue({ name: 'fakeWiki' } as never)
    jest.mocked(getAllCharactersIncludingDeleted).mockResolvedValue([
      { id: 'c1', save_to_cloud: true, cloud_id: UUID, deleted_at: null } as never,
    ])
    jest.mocked(wikiOrchestrator.syncAll).mockRejectedValueOnce(
      new WikiBusyError('librarian', 'c1'),
    )
    const { reportError } = require('~/utilities/reportError')

    await syncAllToCloud('user1')

    expect(reportError).not.toHaveBeenCalled()
  })
})
