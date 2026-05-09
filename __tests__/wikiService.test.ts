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

import { setupWiki, getWiki, initWiki, _resetWikiForTests } from '~/services/wikiService'

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
    const db = {} as any
    await initWiki(db)
    expect(mockSetup).toHaveBeenCalledTimes(1)
  })

  it('passes preFilterLimit and hybridWeight to createWiki config', () => {
    const db = {} as any
    setupWiki(db)
    expect(mockCreateWiki).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        config: expect.objectContaining({
          preFilterLimit: 300,
          hybridWeight: 0.7,
        }),
      }),
    )
  })

  it('passes mobile-first defaults to createWiki config', () => {
    const db = {} as any
    setupWiki(db)
    expect(mockCreateWiki).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        config: expect.objectContaining({
          tablePrefix: 'llm_wiki_',
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
