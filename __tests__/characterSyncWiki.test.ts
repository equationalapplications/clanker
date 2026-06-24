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
jest.mock('@equationalapplications/expo-llm-wiki', () => ({
  WikiBusyError: class WikiBusyError extends Error {
    operation: string
    entityId: string
    constructor(op: string, eid: string) {
      super(`Wiki busy: ${op} on ${eid}`)
      this.name = 'WikiBusyError'
      this.operation = op
      this.entityId = eid
    }
  },
}))

import { syncAllToCloud, restoreFromCloud } from '../src/services/characterSyncService'
import { reportError } from '~/utilities/reportError'
import { getUserCharactersFn } from '~/services/apiClient'

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

  it('skips syncAll when no cloud-linked characters exist', async () => {
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([
      makeCloudChar({ save_to_cloud: 0, cloud_id: null }),
    ])

    await syncAllToCloud('user-1')

    expect(mockSyncAll).not.toHaveBeenCalled()
  })

  it('routes sync through wikiOrchestrator.syncAll', async () => {
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([makeCloudChar()])

    await syncAllToCloud('user-1')

    expect(mockSyncAll).toHaveBeenCalledTimes(1)
    const [itemsArg, wikiArg, concurrencyArg] = mockSyncAll.mock.calls[0]
    expect(wikiArg).toEqual({})
    expect(concurrencyArg).toBe(2)
    expect(itemsArg).toHaveLength(1)
    expect(itemsArg[0].entityId).toBe(LOCAL_ID)
  })

  it('batches all cloud-linked characters into one syncAll call', async () => {
    const secondLocalId = 'char-local-2'
    const secondCloudId = '550e8400-e29b-41d4-a716-446655440001'
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([
      makeCloudChar(),
      makeCloudChar({ id: secondLocalId, cloud_id: secondCloudId }),
    ])

    await syncAllToCloud('user-1')

    expect(mockSyncAll).toHaveBeenCalledTimes(1)
    const [itemsArg, wikiArg, concurrencyArg] = mockSyncAll.mock.calls[0]
    expect(wikiArg).toEqual({})
    expect(concurrencyArg).toBe(2)
    expect(itemsArg).toHaveLength(2)
    expect(itemsArg.map((item: { entityId: string }) => item.entityId)).toEqual([LOCAL_ID, secondLocalId])
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

  it('propagates edges through runRemoteSync in both directions', async () => {
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([makeCloudChar()])
    await syncAllToCloud('user-1')

    const [itemsArg] = mockSyncAll.mock.calls[0]
    const runRemoteSync = itemsArg[0].runRemoteSync as (dump: any) => Promise<any>
    mockWikiSyncFn.mockResolvedValue({
      data: {
        remoteDump: {
          generatedAt: 1001,
          entities: {
            [CLOUD_ID]: {
              facts: [], tasks: [], events: [],
              edges: [{ id: 're1', entity_id: CLOUD_ID, source_id: 'a', target_id: 'b', edge_type: 'knows', created_at: 5 }],
            },
          },
        },
      },
    })

    const remapped = await runRemoteSync({
      generatedAt: 1000,
      entities: {
        [LOCAL_ID]: {
          facts: [], tasks: [], events: [],
          edges: [{ id: 'le1', entity_id: LOCAL_ID, source_id: 'a', target_id: 'b', edge_type: 'knows', created_at: 4 }],
        },
      },
    })

    const syncArg = mockWikiSyncFn.mock.calls[mockWikiSyncFn.mock.calls.length - 1][0]
    expect(syncArg.dump.entities[CLOUD_ID].edges).toEqual([
      { id: 'le1', entity_id: CLOUD_ID, source_id: 'a', target_id: 'b', edge_type: 'knows', created_at: 4 },
    ])
    expect(remapped.entities[LOCAL_ID].edges).toEqual([
      { id: 're1', entity_id: LOCAL_ID, source_id: 'a', target_id: 'b', edge_type: 'knows', created_at: 5 },
    ])
  })

  it('propagates ontology through runRemoteSync in both directions', async () => {
    const localOntology = {
      mode: 'emergent' as const,
      manifest: {
        node_types: [{ type: 'person', description: 'A person' }],
        edge_types: [{ type: 'knows', source_type: 'person', target_type: 'person', description: 'Knows' }],
      },
    }
    const remoteOntology = {
      mode: 'strict' as const,
      manifest: {
        node_types: [{ type: 'place', description: 'A place' }],
        edge_types: [{ type: 'located_in', source_type: 'person', target_type: 'place', description: 'Located in' }],
      },
    }
    const mockGetOntologyManifest = jest.fn().mockResolvedValue(localOntology)
    const mockSetOntologyManifest = jest.fn().mockResolvedValue(undefined)
    mockGetWiki.mockReturnValue({
      getOntologyManifest: mockGetOntologyManifest,
      setOntologyManifest: mockSetOntologyManifest,
    })
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([makeCloudChar()])
    await syncAllToCloud('user-1')

    const [itemsArg] = mockSyncAll.mock.calls[0]
    const runRemoteSync = itemsArg[0].runRemoteSync as (dump: any) => Promise<any>
    mockWikiSyncFn.mockResolvedValue({
      data: {
        remoteDump: {
          generatedAt: 1001,
          entities: {
            [CLOUD_ID]: {
              facts: [], tasks: [], events: [], edges: [],
              ontology: remoteOntology,
            },
          },
        },
      },
    })

    await runRemoteSync({
      generatedAt: 1000,
      entities: {
        [LOCAL_ID]: { facts: [], tasks: [], events: [], edges: [] },
      },
    })

    const syncArg = mockWikiSyncFn.mock.calls[mockWikiSyncFn.mock.calls.length - 1][0]
    expect(syncArg.dump.entities[CLOUD_ID].ontology).toEqual(localOntology)
    expect(mockSetOntologyManifest).toHaveBeenCalledWith(LOCAL_ID, remoteOntology.manifest, { mode: 'strict' })
  })

  it('continues fail-soft when orchestrator sync throws', async () => {
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([makeCloudChar()])
    mockSyncAll.mockRejectedValue(new Error('network error'))

    await syncAllToCloud('user-1')
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      'wiki:sync:batch',
    )
  })

  it('short-circuits when syncAll throws WikiBusyError', async () => {
    const { WikiBusyError } = require('@equationalapplications/expo-llm-wiki')
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([makeCloudChar()])
    mockSyncAll.mockRejectedValue(new WikiBusyError('sync', LOCAL_ID))

    await syncAllToCloud('user-1')
    expect(reportError).not.toHaveBeenCalled()
  })

  it('isolates per-character runRemoteSync failures in batched mode', async () => {
    const secondLocalId = 'char-local-2'
    const secondCloudId = '550e8400-e29b-41d4-a716-446655440001'
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([
      makeCloudChar(),
      makeCloudChar({ id: secondLocalId, cloud_id: secondCloudId }),
    ])

    await syncAllToCloud('user-1')

    const [itemsArg] = mockSyncAll.mock.calls[0]
    const firstRunRemoteSync = itemsArg[0].runRemoteSync as (dump: any) => Promise<any>
    const secondRunRemoteSync = itemsArg[1].runRemoteSync as (dump: any) => Promise<any>

    mockWikiSyncFn.mockRejectedValueOnce(new Error('first character sync failed'))
    await expect(firstRunRemoteSync({
      generatedAt: 1000,
      entities: { [LOCAL_ID]: { facts: [{ id: 'f1', entity_id: LOCAL_ID }], tasks: [], events: [] } },
    })).rejects.toThrow('first character sync failed')

    // Error reporting now happens in the wiki machine's recordError action, not in runRemoteSync

    mockWikiSyncFn.mockResolvedValueOnce({
      data: {
        remoteDump: {
          generatedAt: 1002,
          entities: { [secondCloudId]: { facts: [{ id: 'rf2' }], tasks: [], events: [] } },
        },
      },
    })
    const secondResult = await secondRunRemoteSync({
      generatedAt: 1001,
      entities: { [secondLocalId]: { facts: [{ id: 'f2', entity_id: secondLocalId }], tasks: [], events: [] } },
    })

    expect(secondResult.entities[secondLocalId].facts).toEqual([{ id: 'rf2' }])
  })
})

describe('restoreFromCloud wiki sync reporting', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetWiki.mockReturnValue({})
  })

  it('reports restore wiki sync failures via reportError', async () => {
    ;(getUserCharactersFn as jest.Mock).mockResolvedValue({
      data: {
        characters: [
          {
            id: CLOUD_ID,
            name: 'Restored',
            avatar: null,
            appearance: null,
            traits: null,
            emotions: null,
            context: null,
            isPublic: false,
            createdAt: new Date(1000).toISOString(),
            updatedAt: new Date(2000).toISOString(),
            voice: null,
          },
        ],
      },
    })
    mockGetAllCharactersIncludingDeleted
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('wiki restore sync failed'))

    await expect(restoreFromCloud('user-1')).resolves.toBeUndefined()

    expect(reportError).toHaveBeenCalledWith(expect.any(Error), 'wiki:sync:restore')
  })
})
