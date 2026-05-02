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
    expect(wiki.setup).toBe(mockSetup)
  })

  it('getWiki throws if not initialized', () => {
    expect(() => getWiki()).toThrow()
  })

  it('initWiki calls setup() on the wiki', async () => {
    const db = {} as any
    await initWiki(db)
    expect(mockSetup).toHaveBeenCalledTimes(1)
  })
})
