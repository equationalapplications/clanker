const mockRunAsync = jest.fn()
const mockGetFirstAsync = jest.fn()
const mockGetAllAsync = jest.fn()

jest.mock('../src/database/index', () => ({
  getDatabase: jest.fn(async () => ({
    withTransactionAsync: async (fn: () => Promise<void>) => fn(),
    runAsync: mockRunAsync,
    getFirstAsync: mockGetFirstAsync,
    getAllAsync: mockGetAllAsync,
  })),
  isWikiFtsAvailable: jest.fn(() => true),
}))

import {
  upsertWikiEntries,
  searchEntries,
  getRecentEntries,
  countEntries,
  softDeleteWikiEntries,
  softDeleteAllWikiEntries,
  type WikiEntryUpsertInput,
} from '../src/database/wikiDatabase'

function makeEntry(overrides?: Partial<WikiEntryUpsertInput>): WikiEntryUpsertInput {
  return {
    id: 'entry-1',
    characterId: 'char-1',
    userId: 'user-1',
    title: 'Morning Run',
    body: 'User runs every morning.',
    tags: ['health'],
    confidence: 'inferred',
    sourceType: 'agent_inferred',
    createdAt: 1000,
    updatedAt: 2000,
    lastAccessedAt: null,
    accessCount: 0,
    syncedToCloud: 0,
    cloudId: null,
    deletedAt: null,
    ...overrides,
  }
}

describe('upsertWikiEntries', () => {
  beforeEach(() => jest.clearAllMocks())

  it('does nothing when entries array is empty', async () => {
    await upsertWikiEntries([])
    expect(mockRunAsync).not.toHaveBeenCalled()
  })

  it('inserts a single entry with correct columns', async () => {
    await upsertWikiEntries([makeEntry()])

    expect(mockRunAsync).toHaveBeenCalledTimes(1)
    const [sql, values] = mockRunAsync.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('INSERT INTO wiki_entries')
    expect(sql).toContain('ON CONFLICT(id) DO UPDATE SET')
    expect(values).toContain('entry-1')
    expect(values).toContain('Morning Run')
    expect(values).toContain('User runs every morning.')
    expect(values).toContain('inferred')
    expect(values).toContain('agent_inferred')
    expect(values).toContain(0) // syncedToCloud
    expect(values).toContain(null) // cloudId
  })

  it('inserts multiple entries via separate runAsync calls', async () => {
    await upsertWikiEntries([makeEntry({ id: 'entry-1' }), makeEntry({ id: 'entry-2', title: 'Evening Walk' })])
    expect(mockRunAsync).toHaveBeenCalledTimes(2)
  })

  it('serializes tags as JSON string', async () => {
    await upsertWikiEntries([makeEntry({ tags: ['health', 'goals'] })])
    const [, values] = mockRunAsync.mock.calls[0] as [string, unknown[]]
    expect(values).toContain(JSON.stringify(['health', 'goals']))
  })

  it('includes syncedToCloud and cloudId in insert values', async () => {
    await upsertWikiEntries([makeEntry({ syncedToCloud: 1, cloudId: 'cloud-abc' })])
    const [, values] = mockRunAsync.mock.calls[0] as [string, unknown[]]
    expect(values).toContain(1)
    expect(values).toContain('cloud-abc')
  })

  it('falls back to current timestamp when createdAt/updatedAt are omitted', async () => {
    const entry = makeEntry({ createdAt: undefined, updatedAt: undefined })
    const before = Date.now()
    await upsertWikiEntries([entry])
    const after = Date.now()

    const [, values] = mockRunAsync.mock.calls[0] as [string, unknown[]]
    const createdAt = values[8] as number
    const updatedAt = values[9] as number
    expect(createdAt).toBeGreaterThanOrEqual(before)
    expect(createdAt).toBeLessThanOrEqual(after)
    expect(updatedAt).toBeGreaterThanOrEqual(before)
    expect(updatedAt).toBeLessThanOrEqual(after)
  })
})

describe('searchEntries', () => {
  beforeEach(() => jest.clearAllMocks())

  it('queries wiki_fts with the provided FTS query', async () => {
    mockGetAllAsync.mockResolvedValue([])
    await searchEntries('user-1', 'char-1', '"run"*')

    expect(mockGetAllAsync).toHaveBeenCalledWith(
      expect.stringContaining('wiki_fts MATCH ?'),
      expect.arrayContaining(['"run"*', 'char-1', 'user-1']),
    )
  })

  it('increments access_count for returned rows', async () => {
    mockGetAllAsync.mockResolvedValue([
      { id: 'entry-1', character_id: 'char-1', user_id: 'user-1', title: 'Run', body: 'User runs.', tags: '["health"]', confidence: 'inferred', deleted_at: null },
    ])
    await searchEntries('user-1', 'char-1', '"run"*')

    expect(mockRunAsync).toHaveBeenCalledWith(
      expect.stringContaining('access_count = access_count + 1'),
      expect.arrayContaining(['entry-1']),
    )
  })

  it('does not call runAsync when no rows are returned', async () => {
    mockGetAllAsync.mockResolvedValue([])
    await searchEntries('user-1', 'char-1', '"nothing"*')
    expect(mockRunAsync).not.toHaveBeenCalled()
  })

  it('filters by character_id and user_id and deleted_at IS NULL', async () => {
    mockGetAllAsync.mockResolvedValue([])
    await searchEntries('user-2', 'char-2', '"test"*')

    const [sql, values] = mockGetAllAsync.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('character_id = ?')
    expect(sql).toContain('user_id = ?')
    expect(sql).toContain('deleted_at IS NULL')
    expect(values).toContain('char-2')
    expect(values).toContain('user-2')
  })
})

describe('getRecentEntries', () => {
  beforeEach(() => jest.clearAllMocks())

  it('queries wiki_entries ordered by recency without deleted', async () => {
    mockGetAllAsync.mockResolvedValue([])
    await getRecentEntries('user-1', 'char-1', 5)

    const [sql, values] = mockGetAllAsync.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('ORDER BY COALESCE(last_accessed_at, updated_at) DESC')
    expect(sql).toContain('deleted_at IS NULL')
    expect(values).toContain(5)
  })
})

describe('countEntries', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns count from database', async () => {
    mockGetFirstAsync.mockResolvedValue({ count: 7 })
    const result = await countEntries('user-1', 'char-1')
    expect(result).toBe(7)
  })

  it('returns 0 when row is null', async () => {
    mockGetFirstAsync.mockResolvedValue(null)
    const result = await countEntries('user-1', 'char-1')
    expect(result).toBe(0)
  })

  it('only counts non-deleted entries', async () => {
    mockGetFirstAsync.mockResolvedValue({ count: 2 })
    await countEntries('user-1', 'char-1')

    const [sql] = mockGetFirstAsync.mock.calls[0] as [string]
    expect(sql).toContain('deleted_at IS NULL')
  })
})

describe('softDeleteWikiEntries', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 0 and does nothing when entryIds is empty', async () => {
    const result = await softDeleteWikiEntries('char-1', 'user-1', [])
    expect(result).toBe(0)
    expect(mockRunAsync).not.toHaveBeenCalled()
  })

  it('sets deleted_at, updated_at, and synced_to_cloud=0 for given ids', async () => {
    mockRunAsync.mockResolvedValue({ changes: 1 })
    const before = Date.now()
    await softDeleteWikiEntries('char-1', 'user-1', ['entry-1'])
    const after = Date.now()

    const [sql, values] = mockRunAsync.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('deleted_at = ?')
    expect(sql).toContain('synced_to_cloud = 0')
    expect(sql).toContain('id = ?')
    expect(values[0] as number).toBeGreaterThanOrEqual(before)
    expect(values[0] as number).toBeLessThanOrEqual(after)
    expect(values).toContain('entry-1')
    expect(values).toContain('char-1')
    expect(values).toContain('user-1')
  })

  it('returns total number of changed rows', async () => {
    mockRunAsync.mockResolvedValue({ changes: 1 })
    const result = await softDeleteWikiEntries('char-1', 'user-1', ['entry-1', 'entry-2'])
    expect(result).toBe(2)
    expect(mockRunAsync).toHaveBeenCalledTimes(2)
  })
})

describe('softDeleteAllWikiEntries', () => {
  beforeEach(() => jest.clearAllMocks())

  it('bulk soft-deletes all non-deleted entries for character', async () => {
    mockRunAsync.mockResolvedValue({ changes: 5 })
    const result = await softDeleteAllWikiEntries('char-1', 'user-1')

    expect(result).toBe(5)
    const [sql, values] = mockRunAsync.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('deleted_at = ?')
    expect(sql).toContain('synced_to_cloud = 0')
    expect(sql).toContain('deleted_at IS NULL')
    expect(values).toContain('char-1')
    expect(values).toContain('user-1')
  })

  it('returns 0 when no rows match', async () => {
    mockRunAsync.mockResolvedValue({ changes: 0 })
    const result = await softDeleteAllWikiEntries('char-1', 'user-1')
    expect(result).toBe(0)
  })
})
