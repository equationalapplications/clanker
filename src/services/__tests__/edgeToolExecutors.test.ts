import { edgeToolExecutors, createEdgeToolExecutors } from '../edgeToolExecutors'
import { readFromWiki } from '../wikiService'

jest.mock('../wikiService', () => ({
  readFromWiki: jest.fn(),
}))

const mockReadFromWiki = readFromWiki as jest.Mock

describe('edgeToolExecutors (static map)', () => {
  describe('get_current_time', () => {
    it('is present in the executor map', () => {
      expect(typeof edgeToolExecutors['get_current_time']).toBe('function')
    })

    it('returns a non-empty string', () => {
      const result = edgeToolExecutors['get_current_time']({})
      expect(typeof result).toBe('string')
      expect((result as string).length).toBeGreaterThan(0)
    })

    it('output contains a year (4-digit number)', () => {
      const result = edgeToolExecutors['get_current_time']({}) as string
      expect(result).toMatch(/\d{4}/)
    })
  })

  it('escalate_to_cloud is NOT in the executor map', () => {
    expect(edgeToolExecutors['escalate_to_cloud']).toBeUndefined()
  })

  it('search_memory is NOT in the static executor map', () => {
    expect(edgeToolExecutors['search_memory']).toBeUndefined()
  })
})

describe('createEdgeToolExecutors', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('includes get_current_time from static map', () => {
    const execs = createEdgeToolExecutors('char-1', null)
    expect(typeof execs['get_current_time']).toBe('function')
  })

  it('includes search_memory', () => {
    const execs = createEdgeToolExecutors('char-1', null)
    expect(typeof execs['search_memory']).toBe('function')
  })

  describe('search_memory', () => {
    it('returns "No relevant memories found." when wiki is null', async () => {
      const execs = createEdgeToolExecutors('char-1', null)
      const result = await execs['search_memory']({ query: 'anything' })
      expect(result).toBe('No relevant memories found.')
      expect(mockReadFromWiki).not.toHaveBeenCalled()
    })

    it('returns "No relevant memories found." when query is empty string', async () => {
      const wiki = {} as any
      const execs = createEdgeToolExecutors('char-1', wiki)
      const result = await execs['search_memory']({ query: '' })
      expect(result).toBe('No relevant memories found.')
      expect(mockReadFromWiki).not.toHaveBeenCalled()
    })

    it('returns "No relevant memories found." when wiki returns all empty arrays', async () => {
      mockReadFromWiki.mockResolvedValue({ facts: [], tasks: [], events: [] })
      const wiki = {} as any
      const execs = createEdgeToolExecutors('char-1', wiki)
      const result = await execs['search_memory']({ query: 'coffee' })
      expect(result).toBe('No relevant memories found.')
    })

    it('returns JSON string when wiki returns facts', async () => {
      const mockResults = { facts: [{ content: 'User likes coffee' }], tasks: [], events: [] }
      mockReadFromWiki.mockResolvedValue(mockResults)
      const wiki = {} as any
      const execs = createEdgeToolExecutors('char-1', wiki)
      const result = await execs['search_memory']({ query: 'coffee' })
      expect(result).toBe(JSON.stringify(mockResults))
    })

    it('returns JSON string when wiki returns tasks', async () => {
      const mockResults = { facts: [], tasks: [{ content: 'Buy groceries' }], events: [] }
      mockReadFromWiki.mockResolvedValue(mockResults)
      const wiki = {} as any
      const execs = createEdgeToolExecutors('char-1', wiki)
      const result = await execs['search_memory']({ query: 'groceries' })
      expect(result).toBe(JSON.stringify(mockResults))
    })

    it('returns JSON string when wiki returns events', async () => {
      const mockResults = { facts: [], tasks: [], events: [{ content: 'Met at park' }] }
      mockReadFromWiki.mockResolvedValue(mockResults)
      const wiki = {} as any
      const execs = createEdgeToolExecutors('char-1', wiki)
      const result = await execs['search_memory']({ query: 'park' })
      expect(result).toBe(JSON.stringify(mockResults))
    })

    it('calls readFromWiki with correct characterId and query', async () => {
      mockReadFromWiki.mockResolvedValue({ facts: [], tasks: [], events: [] })
      const wiki = {} as any
      const execs = createEdgeToolExecutors('char-42', wiki)
      await execs['search_memory']({ query: 'favorite food' })
      expect(mockReadFromWiki).toHaveBeenCalledWith(wiki, 'char-42', 'favorite food')
    })

    it('does not call readFromWiki when query is missing from args', async () => {
      const wiki = {} as any
      const execs = createEdgeToolExecutors('char-1', wiki)
      const result = await execs['search_memory']({})
      expect(result).toBe('No relevant memories found.')
      expect(mockReadFromWiki).not.toHaveBeenCalled()
    })

    it('returns "No relevant memories found." when readFromWiki throws', async () => {
      mockReadFromWiki.mockRejectedValue(new Error('SQLite locked'))
      const wiki = {} as any
      const execs = createEdgeToolExecutors('char-1', wiki)
      const result = await execs['search_memory']({ query: 'coffee' })
      expect(result).toBe('No relevant memories found.')
    })
  })
})
