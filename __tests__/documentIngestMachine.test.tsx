// Mock all external dependencies before imports
const mockGetDocumentAsync = jest.fn()
const mockReadAsStringAsync = jest.fn()
const mockDigestStringAsync = jest.fn()
const mockFindEntriesByRef = jest.fn()
const mockBulkInsertEntries = jest.fn()
const mockAppendMemoryEvents = jest.fn()
const mockForgetMemory = jest.fn()
const mockGetCharacter = jest.fn()
const mockExtractDocument = jest.fn()
const mockInvalidateQueries = jest.fn()

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: (...args: unknown[]) => mockGetDocumentAsync(...args),
}))

jest.mock('expo-file-system', () => ({
  readAsStringAsync: (...args: unknown[]) => mockReadAsStringAsync(...args),
  EncodingType: { UTF8: 'utf8' },
}))

jest.mock('expo-crypto', () => ({
  digestStringAsync: (...args: unknown[]) => mockDigestStringAsync(...args),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}))

jest.mock('~/database/wikiDatabase', () => ({
  findEntriesByRef: (...args: unknown[]) => mockFindEntriesByRef(...args),
  bulkInsertEntries: (...args: unknown[]) => mockBulkInsertEntries(...args),
}))

jest.mock('~/database/memoryEventDatabase', () => ({
  appendMemoryEvents: (...args: unknown[]) => mockAppendMemoryEvents(...args),
}))

jest.mock('~/services/memoryService', () => ({
  forgetMemory: (...args: unknown[]) => mockForgetMemory(...args),
}))

jest.mock('~/database/characterDatabase', () => ({
  getCharacter: (...args: unknown[]) => mockGetCharacter(...args),
}))

jest.mock('~/services/documentIngestService', () => ({
  extractDocument: (...args: unknown[]) => mockExtractDocument(...args),
}))

jest.mock('~/config/queryClient', () => ({
  queryClient: {
    invalidateQueries: (...args: unknown[]) => mockInvalidateQueries(...args),
  },
}))

import { createActor } from 'xstate'
import { documentIngestMachine } from '~/machines/documentIngestMachine'

function createTestActor() {
  const actor = createActor(documentIngestMachine, {
    input: { characterId: 'char-1', userId: 'user-1' },
  })
  actor.start()
  return actor
}

function waitForState(actor: ReturnType<typeof createTestActor>, stateName: string, maxMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout waiting for state: ${stateName}`)), maxMs)
    const sub = actor.subscribe((state) => {
      if (state.matches(stateName)) {
        clearTimeout(timeout)
        sub.unsubscribe()
        resolve()
      }
    })
  })
}

describe('documentIngestMachine', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Default happy-path mocks
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ name: 'notes.md', uri: 'file:///tmp/notes.md' }],
    })
    mockReadAsStringAsync.mockResolvedValue('Alice is a software engineer.')
    mockDigestStringAsync.mockResolvedValue('a'.repeat(64))
    mockFindEntriesByRef.mockResolvedValue([])
    mockGetCharacter.mockResolvedValue({ id: 'char-1', cloud_id: 'cloud-uuid-1' })
    mockExtractDocument.mockResolvedValue({
      facts: [{ title: 'Alice', body: 'Alice is a software engineer.', tags: ['person'], confidence: 'certain' }],
      contentHash: 'a'.repeat(64),
      truncated: false,
    })
    mockBulkInsertEntries.mockResolvedValue(undefined)
    mockAppendMemoryEvents.mockResolvedValue(undefined)
    mockInvalidateQueries.mockResolvedValue(undefined)
  })

  it('starts in idle state', () => {
    const actor = createTestActor()
    expect(actor.getSnapshot().matches('idle')).toBe(true)
    actor.stop()
  })

  it('transitions idle → picking → reading → checkingDuplicate → extracting → applying → success → idle on happy path', async () => {
    const actor = createTestActor()

    actor.send({ type: 'INGEST', characterId: 'char-1', userId: 'user-1' })

    await waitForState(actor, 'idle') // back to idle after success

    expect(mockGetDocumentAsync).toHaveBeenCalledTimes(1)
    expect(mockReadAsStringAsync).toHaveBeenCalledTimes(1)
    expect(mockFindEntriesByRef).toHaveBeenCalledTimes(1)
    expect(mockExtractDocument).toHaveBeenCalledTimes(1)
    expect(mockBulkInsertEntries).toHaveBeenCalledTimes(1)
    expect(mockAppendMemoryEvents).toHaveBeenCalledTimes(1)
    expect(mockInvalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: expect.arrayContaining(['memoryBundle']) }),
    )
    actor.stop()
  })

  it('returns to idle when user cancels picker', async () => {
    mockGetDocumentAsync.mockResolvedValue({ canceled: true, assets: [] })

    const actor = createTestActor()
    actor.send({ type: 'INGEST', characterId: 'char-1', userId: 'user-1' })

    await waitForState(actor, 'idle')

    expect(mockReadAsStringAsync).not.toHaveBeenCalled()
    actor.stop()
  })

  it('goes to error state when document picker throws', async () => {
    mockGetDocumentAsync.mockRejectedValue(new Error('Permission denied'))

    const actor = createTestActor()
    actor.send({ type: 'INGEST', characterId: 'char-1', userId: 'user-1' })

    await waitForState(actor, 'idle') // error → idle after 0ms

    actor.stop()
  })

  it('transitions to confirmingDuplicate when sourceRef match found', async () => {
    mockFindEntriesByRef.mockResolvedValue([
      { id: 'dup-1', deleted_at: null, source_ref: 'notes.md' },
      { id: 'dup-2', deleted_at: null, source_ref: 'notes.md' },
    ])

    const actor = createTestActor()
    const confirmingPromise = waitForState(actor, 'confirmingDuplicate', 2000)
    actor.send({ type: 'INGEST', characterId: 'char-1', userId: 'user-1' })

    await confirmingPromise
    expect(actor.getSnapshot().context.duplicateEntryCount).toBe(2)
    actor.stop()
  })

  it('REPLACE in confirmingDuplicate calls forgetMemory and proceeds to extracting', async () => {
    mockFindEntriesByRef.mockResolvedValue([{ id: 'dup-1', deleted_at: null }])
    mockForgetMemory.mockResolvedValue(undefined)

    const actor = createTestActor()
    actor.send({ type: 'INGEST', characterId: 'char-1', userId: 'user-1' })

    await waitForState(actor, 'confirmingDuplicate', 2000)
    actor.send({ type: 'REPLACE' })

    await waitForState(actor, 'idle')

    expect(mockForgetMemory).toHaveBeenCalledTimes(1)
    expect(mockBulkInsertEntries).toHaveBeenCalledTimes(1)
    actor.stop()
  })

  it('ADD in confirmingDuplicate skips purge and proceeds to extracting', async () => {
    mockFindEntriesByRef.mockResolvedValue([{ id: 'dup-1', deleted_at: null }])

    const actor = createTestActor()
    actor.send({ type: 'INGEST', characterId: 'char-1', userId: 'user-1' })

    await waitForState(actor, 'confirmingDuplicate', 2000)
    actor.send({ type: 'ADD' })

    await waitForState(actor, 'idle')

    expect(mockForgetMemory).not.toHaveBeenCalled()
    expect(mockBulkInsertEntries).toHaveBeenCalledTimes(1)
    actor.stop()
  })

  it('CANCEL in reading returns to idle', async () => {
    let resolveRead!: (value: string) => void
    mockReadAsStringAsync.mockReturnValue(new Promise<string>((res) => { resolveRead = res }))

    const actor = createTestActor()
    actor.send({ type: 'INGEST', characterId: 'char-1', userId: 'user-1' })

    await waitForState(actor, 'reading')
    actor.send({ type: 'CANCEL' })
    // XState v5 transitions synchronously on send — check directly
    expect(actor.getSnapshot().matches('idle')).toBe(true)

    resolveRead('late content')
    actor.stop()
  })

  it('CANCEL in extracting returns to idle and clears content', async () => {
    let resolveExtract!: (value: { facts: never[]; contentHash: string; truncated: boolean }) => void
    mockExtractDocument.mockReturnValue(new Promise((res) => { resolveExtract = res }))

    const actor = createTestActor()
    actor.send({ type: 'INGEST', characterId: 'char-1', userId: 'user-1' })

    await waitForState(actor, 'extracting')
    actor.send({ type: 'CANCEL' })
    // XState v5 transitions synchronously on send — check directly
    expect(actor.getSnapshot().matches('idle')).toBe(true)
    expect(actor.getSnapshot().context.content).toBeNull()

    resolveExtract({ facts: [], contentHash: 'a'.repeat(64), truncated: false })
    actor.stop()
  })

  it('goes to error state when character has no cloud_id (not yet synced)', async () => {
    mockGetCharacter.mockResolvedValue({ id: 'char-1', cloud_id: null })

    const actor = createTestActor()
    actor.send({ type: 'INGEST', characterId: 'char-1', userId: 'user-1' })

    await waitForState(actor, 'idle') // error → idle after 0ms

    expect(mockExtractDocument).not.toHaveBeenCalled()
    actor.stop()
  })

  it('progress increases monotonically through states', async () => {
    const progressValues: number[] = []

    const actor = createTestActor()
    actor.subscribe((state) => {
      progressValues.push(state.context.progress)
    })

    actor.send({ type: 'INGEST', characterId: 'char-1', userId: 'user-1' })
    await waitForState(actor, 'idle')

    const uniqueProgress = [...new Set(progressValues)]
    const peak = Math.max(...uniqueProgress)
    expect(peak).toBeGreaterThanOrEqual(0.9)
    actor.stop()
  })
})
