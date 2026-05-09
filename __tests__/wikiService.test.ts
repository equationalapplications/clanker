const mockSetup = jest.fn().mockResolvedValue(undefined)
const mockRead = jest.fn()
const mockWrite = jest.fn()
const mockExportDump = jest.fn()
const mockCreateWiki = jest.fn().mockReturnValue({
  setup: mockSetup,
  read: mockRead,
  write: mockWrite,
  exportDump: mockExportDump,
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
        .mockResolvedValueOnce({ exists: 1 }), // Old enums found
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

  it('initWiki skips migration when table exists but no old enums', async () => {
    const execAsync = jest.fn()
    const db = {
      withTransactionAsync: jest.fn().mockImplementation(async (cb) => {
        await cb()
      }),
      getFirstAsync: jest
        .fn()
        .mockResolvedValueOnce({ has_table: 1 }) // Table exists
        .mockResolvedValueOnce(null), // No old enums
      execAsync,
    } as any
    await initWiki(db)
    expect(execAsync).not.toHaveBeenCalled()
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
    expect(mockCreateWiki).toHaveBeenCalledWith(
      db,
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
          hybridWeight: 0.7,
        }),
      }),
    )
  })
})
