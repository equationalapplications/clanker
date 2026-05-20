const mockSetup = jest.fn().mockResolvedValue(undefined)
const mockRead = jest.fn()
const mockWrite = jest.fn()
const mockExportDump = jest.fn()
const mockCreateWiki = jest.fn().mockReturnValue({
  setup: mockSetup,
  read: mockRead,
  write: mockWrite,
  exportDump: mockExportDump,
  runReembed: jest.fn().mockResolvedValue({ embedded: 0, skipped: 0, failed: 0 }),
})

jest.mock('@equationalapplications/expo-llm-wiki', () => ({
  createWiki: (...args: unknown[]) => mockCreateWiki(...args),
}))

jest.mock('~/services/wikiLlmProvider', () => ({
  createWikiLlmProvider: jest.fn().mockReturnValue({ generateText: jest.fn() }),
}))

import {
  setupWiki,
  getWiki,
  initWiki,
  _resetWikiForTests,
  readFromWiki,
  clearWikiNoResultCache,
  TABLE_PREFIX,
} from '~/services/wikiService'

describe('wikiService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    _resetWikiForTests()
  })

  it('setupWiki initializes the wiki singleton', () => {
    const db = {} as any
    setupWiki(db)
    expect(mockCreateWiki).toHaveBeenCalledWith(db, expect.any(Object))
  })

  it('getWiki returns the initialized wiki', () => {
    const db = {} as any
    setupWiki(db)
    const wiki = getWiki()
    expect(wiki).toBeDefined()
    expect(wiki!.setup).toBe(mockSetup)
  })

  it('getWiki returns null if not initialized', () => {
    expect(getWiki()).toBeNull()
  })

  it('initWiki calls setup() on the wiki', async () => {
    const db = {
      withTransactionAsync: jest.fn().mockImplementation(async (cb) => {
        await cb()
      }),
      getFirstAsync: jest.fn().mockResolvedValue(null), // No table exists (fresh install)
    } as any
    await initWiki(db)
    expect(mockSetup).toHaveBeenCalledTimes(1)
  })

  it('initWiki runs enum migration when old v3 enum values exist', async () => {
    const execAsync = jest.fn().mockResolvedValue(undefined)
    const db = {
      withTransactionAsync: jest.fn().mockImplementation(async (cb) => {
        await cb()
      }),
      getFirstAsync: jest
        .fn()
        .mockResolvedValueOnce({ has_table: 1 }) // Table exists
        .mockResolvedValueOnce({ has_old_enums: 1 }), // Old enums found
      execAsync,
    } as any
    await initWiki(db)
    expect(execAsync).toHaveBeenCalledWith(
      expect.stringContaining("SET source_type = 'immutable_document'"),
    )
    expect(execAsync).toHaveBeenCalledWith(
      expect.stringContaining("SET source_type = 'librarian_inferred'"),
    )
    expect(mockSetup).toHaveBeenCalledTimes(1)
  })

  it('initWiki skips enum migration when table exists but no old enums', async () => {
    const execAsync = jest.fn().mockResolvedValue(undefined)
    const runAsync = jest.fn().mockResolvedValue(undefined)
    const db = {
      withTransactionAsync: jest.fn().mockImplementation(async (cb) => {
        await cb()
      }),
      getFirstAsync: jest
        .fn()
        .mockResolvedValueOnce({ has_table: 1 }) // Table exists
        .mockResolvedValueOnce(null), // No old enums
      execAsync,
      runAsync,
    } as any
    await initWiki(db)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(execAsync).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS "llm_wiki_meta"'),
    )
    expect(runAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR REPLACE INTO "llm_wiki_meta"'),
      expect.any(Array),
    )
    expect(mockSetup).toHaveBeenCalledTimes(1)
  })

  it('initWiki skips migration on fresh install (no table)', async () => {
    const execAsync = jest.fn()
    const db = {
      withTransactionAsync: jest.fn().mockImplementation(async (cb) => {
        await cb()
      }),
      getFirstAsync: jest.fn().mockResolvedValue(null), // No table exists
      execAsync,
    } as any
    await initWiki(db)
    expect(execAsync).not.toHaveBeenCalled()
    expect(mockSetup).toHaveBeenCalledTimes(1)
  })

  it('passes mobile-first defaults to createWiki config', () => {
    const db = {} as any
    setupWiki(db)
    expect(mockCreateWiki).toHaveBeenCalledTimes(1)
    const createWikiArgs = mockCreateWiki.mock.calls[0]
    const optionsArg = createWikiArgs[1] ?? createWikiArgs[0]

    if (createWikiArgs.length > 1) {
      expect(createWikiArgs[0]).toBe(db)
    }

    expect(optionsArg).toEqual(
      expect.objectContaining({
        config: expect.objectContaining({
          tablePrefix: TABLE_PREFIX,
          autoLibrarianThreshold: 5,
          autoHealThreshold: 100,
          pruneRetainSoftDeletedFor: 3,
          pruneEventsAfter: 14,
          orphanAfterDays: 14,
          staleInferredAfterDays: 30,
          preFilterLimit: 300,
          hybridWeight: 1,
        }),
      }),
    )
  })

  it('retries a full-scan read when the prefiltered read returns no facts', async () => {
    const db = {} as any
    setupWiki(db)
    mockRead
      .mockResolvedValueOnce({ facts: [], tasks: [], events: [] })
      .mockResolvedValueOnce({ facts: [{ id: 'fact-1' }], tasks: [], events: [] })

    const wiki = getWiki()!
    const result = await readFromWiki(wiki, 'entity-id', 'some query')

    expect(mockRead).toHaveBeenCalledTimes(2)
    expect(mockRead.mock.calls[0][2]).toBeUndefined()
    expect(mockRead.mock.calls[1][2]).toEqual({ preFilterLimit: null })
    expect(result.facts).toHaveLength(1)
  })

  it('caches no-result wiki queries to avoid repeated full-scan retries', async () => {
    const db = {} as any
    setupWiki(db)
    mockRead
      .mockResolvedValueOnce({ facts: [], tasks: [], events: [] })
      .mockResolvedValueOnce({ facts: [], tasks: [], events: [] })
      .mockResolvedValueOnce({ facts: [], tasks: [], events: [] })

    const wiki = getWiki()!
    await readFromWiki(wiki, 'entity-id', 'some query')
    expect(mockRead).toHaveBeenCalledTimes(2)

    await readFromWiki(wiki, 'entity-id', 'some query')
    expect(mockRead).toHaveBeenCalledTimes(3)
  })

  it('clears cached no-result wiki queries for a specific entity', async () => {
    const db = {} as any
    setupWiki(db)
    mockRead
      .mockResolvedValueOnce({ facts: [], tasks: [], events: [] })
      .mockResolvedValueOnce({ facts: [], tasks: [], events: [] })
      .mockResolvedValueOnce({ facts: [{ id: 'fact-1' }], tasks: [], events: [] })

    const wiki = getWiki()!
    await readFromWiki(wiki, 'entity-id', 'some query')
    expect(mockRead).toHaveBeenCalledTimes(2)

    clearWikiNoResultCache('entity-id')
    const result = await readFromWiki(wiki, 'entity-id', 'some query')
    expect(mockRead).toHaveBeenCalledTimes(3)
    expect(result.facts).toHaveLength(1)
  })

  it('clears cached no-result wiki queries when reset for tests', async () => {
    const db = {} as any
    setupWiki(db)
    mockRead
      .mockResolvedValueOnce({ facts: [], tasks: [], events: [] })
      .mockResolvedValueOnce({ facts: [], tasks: [], events: [] })
      .mockResolvedValueOnce({ facts: [{ id: 'fact-1' }], tasks: [], events: [] })

    const wiki = getWiki()!
    await readFromWiki(wiki, 'entity-id', 'some query')
    expect(mockRead).toHaveBeenCalledTimes(2)

    _resetWikiForTests()
    setupWiki(db)
    const result = await readFromWiki(getWiki()!, 'entity-id', 'some query')
    expect(mockRead).toHaveBeenCalledTimes(3)
    expect(result.facts).toHaveLength(1)
  })

  it('starts wiki embedding migration in the background without blocking init', async () => {
    let resolveExec!: () => void
    const dbExecAsync = jest.fn().mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveExec = resolve
      }),
    )
    const runReembed = jest.fn().mockResolvedValue({ embedded: 0, skipped: 0, failed: 0 })
    mockCreateWiki.mockReturnValueOnce({
      setup: mockSetup,
      read: mockRead,
      write: mockWrite,
      exportDump: mockExportDump,
      runReembed,
    })

    const db = {
      getFirstAsync: jest.fn().mockResolvedValue({ has_table: 1 }),
      execAsync: dbExecAsync,
      runAsync: jest.fn().mockResolvedValue(undefined),
    } as any

    await initWiki(db)
    expect(mockSetup).toHaveBeenCalledTimes(1)
    expect(runReembed).not.toHaveBeenCalled()

    resolveExec()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(runReembed).toHaveBeenCalledTimes(1)
  })

  it('does not mark wiki embedding migration complete when the reembed reports failures', async () => {
    const runReembed = jest.fn().mockResolvedValue({ embedded: 0, skipped: 0, failed: 1 })
    mockCreateWiki.mockReturnValueOnce({
      setup: mockSetup,
      read: mockRead,
      write: mockWrite,
      exportDump: mockExportDump,
      runReembed,
    })

    const db = {
      getFirstAsync: jest.fn().mockResolvedValue({ has_table: 1 }),
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockResolvedValue(undefined),
    } as any

    await initWiki(db)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(runReembed).toHaveBeenCalledTimes(1)
    expect(db.runAsync).toHaveBeenCalledTimes(1)
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR REPLACE INTO "llm_wiki_meta"'),
      expect.arrayContaining(['wiki_embedding_tasktype_migration_v1_failed', expect.any(String)]),
    )
  })
})
