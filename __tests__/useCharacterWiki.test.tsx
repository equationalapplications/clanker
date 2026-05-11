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

import { renderHook } from '@testing-library/react'
import { useCharacterWiki, _resetCharacterWikiEntityQueuesForTests } from '~/hooks/useCharacterWiki'
import { useWiki } from '@equationalapplications/expo-llm-wiki'
import { wikiOrchestrator } from '~/services/wikiOrchestrator'

const mockUseWiki = jest.mocked(useWiki)
const mockGetOrSpawn = jest.mocked(wikiOrchestrator.getOrSpawn)

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

  test('ingest returns lastIngestResult from context', async () => {
    const mockWiki = {} as any
    mockUseWiki.mockReturnValue(mockWiki)
    
    const ingestResult = { chunks: 7 }
    const mockActor = {
      getSnapshot: jest.fn().mockReturnValue({
        matches: jest.fn((state: string) => state === 'idle'),
        context: {
          status: { ingesting: false, librarian: false, heal: false },
          lastError: null,
          lastIngestResult: ingestResult,
        },
      }),
      subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
      send: jest.fn(),
    }
    mockGetOrSpawn.mockReturnValue(mockActor as any)
    
    const { result } = renderHook(() => useCharacterWiki('char1'))
    
    const doc = { sourceRef: 's', sourceHash: 'h', documentChunk: 'content' }
    const ingestResultReturned = await result.current.ingest(doc)
    
    expect(ingestResultReturned).toEqual(ingestResult)
  })

  test('read returns lastReadResult from context', async () => {
    const mockWiki = {} as any
    mockUseWiki.mockReturnValue(mockWiki)
    
    const readResult = { facts: [{ id: 'f1' }], tasks: [], events: [] }
    const mockActor = {
      getSnapshot: jest.fn().mockReturnValue({
        matches: jest.fn((state: string) => state === 'idle'),
        context: {
          status: { ingesting: false, librarian: false, heal: false },
          lastError: null,
          lastReadResult: readResult,
        },
      }),
      subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
      send: jest.fn(),
    }
    mockGetOrSpawn.mockReturnValue(mockActor as any)
    
    const { result } = renderHook(() => useCharacterWiki('char1'))
    
    const readResultReturned = await result.current.read('test query')
    
    expect(readResultReturned).toEqual(readResult)
  })
})
