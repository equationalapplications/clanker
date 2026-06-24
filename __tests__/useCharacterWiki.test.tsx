/**
 * @jest-environment jsdom
 */
jest.mock('~/services/wikiOrchestrator', () => ({
  wikiOrchestrator: {
    getOrSpawn: jest.fn(),
  },
}))
jest.mock('@equationalapplications/expo-llm-wiki', () => ({
  useWiki: jest.fn(),
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
  formatContext: jest.fn((bundle) => JSON.stringify(bundle)),
}))
jest.mock('~/services/apiClient', () => ({
  wikiSync: jest.fn(),
}))

import { act, renderHook } from '@testing-library/react'
import { useCharacterWiki, _resetCharacterWikiEntityQueuesForTests } from '~/hooks/useCharacterWiki'
import { useWiki } from '@equationalapplications/expo-llm-wiki'
import { wikiOrchestrator } from '~/services/wikiOrchestrator'
import { wikiSync } from '~/services/apiClient'

const mockUseWiki = jest.mocked(useWiki)
const mockGetOrSpawn = jest.mocked(wikiOrchestrator.getOrSpawn)
const mockWikiSync = jest.mocked(wikiSync)

describe('useCharacterWiki', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    _resetCharacterWikiEntityQueuesForTests()
  })

  test('returns null operations when wiki is unavailable', async () => {
    mockUseWiki.mockReturnValue(null as any)
    const { result } = renderHook(() => useCharacterWiki('char1'))
    await expect(result.current.read('test')).resolves.toBeNull()
  })

  const createMockActor = ({
    lastReadResult = { facts: [], tasks: [], events: [] },
    lastIngestResult = { truncated: false, chunks: 7 },
  }: { lastReadResult?: { facts: unknown[]; tasks: unknown[]; events: unknown[] }; lastIngestResult?: { truncated: boolean; chunks: number } } = {}) => {
    let state = 'idle'
    let status = { ingesting: false, librarian: false, heal: false }
    let callback: ((snap: any) => void) | null = null

    const snapshot = (currentState: string) => ({
      matches: (matcher: string) => matcher === currentState,
      context: {
        status,
        lastError: null,
        lastReadResult,
        lastIngestResult,
      },
    })

    const mockActor = {
      getSnapshot: jest.fn().mockImplementation(() => snapshot(state)),
      subscribe: jest.fn().mockImplementation((cb) => {
        callback = cb
        cb(snapshot(state))
        return { unsubscribe: jest.fn() }
      }),
      send: jest.fn().mockImplementation((event) => {
        if (event.type === 'INGEST') {
          state = 'ingesting'
          status = { ingesting: true, librarian: false, heal: false }
          callback?.(snapshot(state))
          Promise.resolve().then(() => {
            state = 'idle'
            status = { ingesting: false, librarian: false, heal: false }
            callback?.(snapshot(state))
          })
        }
        if (event.type === 'READ') {
          state = 'reading'
          callback?.(snapshot(state))
          Promise.resolve().then(() => {
            state = 'idle'
            callback?.(snapshot(state))
          })
        }
        if (event.type === 'SYNC') {
          state = 'syncing'
          callback?.(snapshot(state))
          Promise.resolve()
            .then(() => event.runRemoteSync({
              generatedAt: 1000,
              entities: {
                char1: {
                  facts: [],
                  tasks: [],
                  events: [],
                  edges: [{ id: 'local-edge', entity_id: 'char1', source_id: 'a', target_id: 'b', edge_type: 'knows', created_at: 1 }],
                },
              },
            }))
            .then(() => {
              state = 'idle'
              callback?.(snapshot(state))
            })
        }
      }),
    }

    return mockActor as any
  }

  test('ingest returns lastIngestResult from context', async () => {
    const mockWiki = {} as any
    mockUseWiki.mockReturnValue(mockWiki)
    
    const mockActor = createMockActor()
    mockGetOrSpawn.mockReturnValue(mockActor)
    
    const { result } = renderHook(() => useCharacterWiki('char1'))
    
    const doc = { sourceRef: 's', sourceHash: 'h', documentChunk: 'content' }
    let ingestResultReturned: any
    await act(async () => {
      ingestResultReturned = await result.current.ingest(doc)
    })
    
    expect(ingestResultReturned).toEqual({ truncated: false, chunks: 7 })
  })

  test('ingest waits for the actor ingesting cycle before resolving', async () => {
    const mockWiki = {} as any
    mockUseWiki.mockReturnValue(mockWiki)

    let state = 'idle'
    let status = { ingesting: false, librarian: false, heal: false }
    let callback: ((snap: any) => void) | null = null
    let continueIngestion: () => void
    const continuePromise = new Promise<void>((resolve) => {
      continueIngestion = resolve
    })

    const snapshot = (currentState: string) => ({
      matches: (matcher: string) => matcher === currentState,
      context: {
        status,
        lastError: null,
        lastIngestResult: { chunks: 7 },
      },
    })

    const mockActor = {
      getSnapshot: jest.fn().mockImplementation(() => snapshot(state)),
      subscribe: jest.fn().mockImplementation((cb) => {
        callback = cb
        cb(snapshot(state))
        return { unsubscribe: jest.fn() }
      }),
      send: jest.fn().mockImplementation((event) => {
        if (event.type === 'INGEST') {
          state = 'ingesting'
          status = { ingesting: true, librarian: false, heal: false }
          callback?.(snapshot(state))
          continuePromise.then(() => {
            state = 'idle'
            status = { ingesting: false, librarian: false, heal: false }
            callback?.(snapshot(state))
          })
        }
      }),
    }

    mockGetOrSpawn.mockReturnValue(mockActor as any)
    const { result } = renderHook(() => useCharacterWiki('char1'))

    const doc = { sourceRef: 's', sourceHash: 'h', documentChunk: 'content' }
    let promise!: Promise<any>

    await act(async () => {
      promise = result.current.ingest(doc)
      await Promise.resolve()
      expect(mockActor.send).toHaveBeenCalledWith({ type: 'INGEST', doc })
      expect(promise).toBeInstanceOf(Promise)
    })

    const settled = { resolved: false, rejected: false }
    promise.then(
      () => {
        settled.resolved = true
      },
      () => {
        settled.rejected = true
      },
    )

    expect(settled.resolved).toBe(false)

    continueIngestion!()
    await act(async () => {
      await expect(promise).resolves.toEqual({ chunks: 7 })
    })
  })

  test('read returns lastReadResult from context', async () => {
    const mockWiki = {} as any
    mockUseWiki.mockReturnValue(mockWiki)
    
    const readResult = { facts: [{ id: 'f1' }], tasks: [], events: [] }
    const mockActor = createMockActor({ lastReadResult: readResult })
    mockGetOrSpawn.mockReturnValue(mockActor)
    
    const { result } = renderHook(() => useCharacterWiki('char1'))
    
    let readResultReturned: any
    await act(async () => {
      readResultReturned = await result.current.read('test query')
    })
    
    expect(readResultReturned).toEqual(readResult)
  })

  test('sync forwards local edges to cloud under the remapped cloud entity id', async () => {
    const mockWiki = {
      getOntologyManifest: jest.fn().mockResolvedValue(null),
      setOntologyManifest: jest.fn().mockResolvedValue(undefined),
    } as any
    mockUseWiki.mockReturnValue(mockWiki)
    const mockActor = createMockActor()
    mockGetOrSpawn.mockReturnValue(mockActor)

    mockWikiSync.mockResolvedValue({
      data: {
        remoteDump: {
          generatedAt: 2000,
          entities: { 'cloud-1': { facts: [], tasks: [], events: [], edges: [] } },
        },
      },
    } as any)

    const { result } = renderHook(() => useCharacterWiki('char1'))
    await act(async () => {
      await result.current.sync('cloud-1')
    })

    const syncArg = mockWikiSync.mock.calls[0][0]
    expect(syncArg.dump.entities['cloud-1'].edges).toEqual([
      { id: 'local-edge', entity_id: 'cloud-1', source_id: 'a', target_id: 'b', edge_type: 'knows', created_at: 1 },
    ])
  })

  test('sync sends the local ontology manifest and writes back the cloud-merged one', async () => {
    const mockWiki = {
      getOntologyManifest: jest.fn().mockResolvedValue({ mode: 'emergent', manifest: { node_types: [], edge_types: [] } }),
      setOntologyManifest: jest.fn().mockResolvedValue(undefined),
    } as any
    mockUseWiki.mockReturnValue(mockWiki)
    const mockActor = createMockActor()
    mockGetOrSpawn.mockReturnValue(mockActor)

    mockWikiSync.mockResolvedValue({
      data: {
        remoteDump: {
          generatedAt: 2000,
          entities: {
            'cloud-1': {
              facts: [],
              tasks: [],
              events: [],
              edges: [],
              ontology: { mode: 'emergent', manifest: { node_types: [{ type: 'person', description: 'a person' }], edge_types: [] } },
            },
          },
        },
      },
    } as any)

    const { result } = renderHook(() => useCharacterWiki('char1'))
    await act(async () => {
      await result.current.sync('cloud-1')
    })

    expect(mockWiki.getOntologyManifest).toHaveBeenCalledWith('char1')
    const syncArg = mockWikiSync.mock.calls[0][0]
    expect(syncArg.dump.entities['cloud-1'].ontology).toEqual({ mode: 'emergent', manifest: { node_types: [], edge_types: [] } })

    expect(mockWiki.setOntologyManifest).toHaveBeenCalledWith(
      'char1',
      { node_types: [{ type: 'person', description: 'a person' }], edge_types: [] },
      { mode: 'emergent' },
    )
  })
})
