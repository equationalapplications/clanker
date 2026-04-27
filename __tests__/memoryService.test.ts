const mockBuildFtsQuery = jest.fn()
const mockSearchEntries = jest.fn()
const mockGetRecentEntries = jest.fn()
const mockGetOpenTasks = jest.fn()
const mockGetRecentEvents = jest.fn()
const mockUpsertWikiEntries = jest.fn()
const mockUpsertAgentTasks = jest.fn()
const mockAppendMemoryEvents = jest.fn()
const mockUpsertDerivedSynonyms = jest.fn()
const mockMemoryWriteFn = jest.fn()
const mockMemoryHealFn = jest.fn()
const mockInvalidateQueries = jest.fn()

jest.mock('~/database/ftsQueryBuilder', () => ({
  buildFtsQuery: (...args: unknown[]) => mockBuildFtsQuery(...args),
}))

jest.mock('~/database/wikiDatabase', () => ({
  searchEntries: (...args: unknown[]) => mockSearchEntries(...args),
  getRecentEntries: (...args: unknown[]) => mockGetRecentEntries(...args),
  upsertWikiEntries: (...args: unknown[]) => mockUpsertWikiEntries(...args),
}), { virtual: true })

jest.mock('~/database/agentTaskDatabase', () => ({
  getOpenTasks: (...args: unknown[]) => mockGetOpenTasks(...args),
  upsertAgentTasks: (...args: unknown[]) => mockUpsertAgentTasks(...args),
}), { virtual: true })

jest.mock('~/database/memoryEventDatabase', () => ({
  getRecentEvents: (...args: unknown[]) => mockGetRecentEvents(...args),
  appendMemoryEvents: (...args: unknown[]) => mockAppendMemoryEvents(...args),
}), { virtual: true })

jest.mock('~/database/derivedSynonymDatabase', () => ({
  upsertDerivedSynonyms: (...args: unknown[]) => mockUpsertDerivedSynonyms(...args),
}), { virtual: true })

jest.mock('~/config/firebaseConfig', () => ({
  appCheckReady: Promise.resolve(),
  memoryWriteFn: (...args: unknown[]) => mockMemoryWriteFn(...args),
  memoryHealFn: (...args: unknown[]) => mockMemoryHealFn(...args),
}))

jest.mock('~/config/queryClient', () => ({
  queryClient: {
    invalidateQueries: (...args: unknown[]) => mockInvalidateQueries(...args),
  },
}))

import { fetchMemoryBundle, triggerMemoryWrite, triggerMemoryHeal } from '~/services/memoryService'

describe('fetchMemoryBundle', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetOpenTasks.mockResolvedValue([{ id: 'task-1', description: 'Follow up', priorityLabel: 'high' }])
    mockGetRecentEvents.mockResolvedValue([{ id: 'event-1', eventType: 'observation', summary: 'User stressed.' }])
  })

  it('queries local FTS results when buildFtsQuery returns tokens', async () => {
    mockBuildFtsQuery.mockResolvedValue('"run"* OR "jog"*')
    mockSearchEntries.mockResolvedValue([
      {
        id: 'entry-1',
        title: 'Morning workouts',
        body: 'User prefers morning workouts.',
        confidence: 'certain',
        tags: ['health'],
      },
    ])

    await expect(fetchMemoryBundle('user-1', 'char-1', 'running')).resolves.toEqual({
      facts: [
        {
          id: 'entry-1',
          title: 'Morning workouts',
          body: 'User prefers morning workouts.',
          confidence: 'certain',
          tags: ['health'],
        },
      ],
      openTasks: [{ id: 'task-1', description: 'Follow up', priorityLabel: 'high' }],
      recentEvents: [{ id: 'event-1', eventType: 'observation', summary: 'User stressed.' }],
    })

    expect(mockBuildFtsQuery).toHaveBeenCalledWith('running', 'char-1')
    expect(mockSearchEntries).toHaveBeenCalledWith('user-1', 'char-1', '"run"* OR "jog"*')
    expect(mockGetRecentEntries).not.toHaveBeenCalled()
  })

  it('falls back to recency when buildFtsQuery returns null', async () => {
    mockBuildFtsQuery.mockResolvedValue(null)
    mockGetRecentEntries.mockResolvedValue([
      {
        id: 'entry-2',
        title: 'Fallback',
        body: 'Most recent memory.',
        confidence: 'inferred',
        tags: [],
      },
    ])

    await fetchMemoryBundle('user-1', 'char-1', 'the and but')

    expect(mockGetRecentEntries).toHaveBeenCalledWith('user-1', 'char-1', 10)
    expect(mockSearchEntries).not.toHaveBeenCalled()
  })
})

describe('triggerMemoryWrite', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockMemoryWriteFn.mockResolvedValue({
      data: {
        diff: {
          entries: [
            {
              id: 'entry-1',
              characterId: 'char-1',
              userId: 'user-1',
              title: 'Morning workouts',
              body: 'User prefers morning workouts.',
              tags: ['health'],
              confidence: 'certain',
            },
          ],
          tasks: [
            {
              id: 'task-1',
              characterId: 'char-1',
              userId: 'user-1',
              description: 'Ask how run went',
              status: 'pending',
              priority: 2,
            },
          ],
          events: [
            {
              id: 'event-1',
              characterId: 'char-1',
              userId: 'user-1',
              eventType: 'observation',
              summary: 'User discussed training.',
            },
          ],
          synonyms: [
            {
              term: 'health',
              synonyms: ['workout'],
            },
          ],
        },
      },
    })
  })

  it('calls memoryWrite callable and applies returned diff locally', async () => {
    await triggerMemoryWrite(
      {
        id: 'char-1',
        name: 'Nova',
        appearance: '',
        traits: '',
        emotions: '',
        context: '',
      },
      'user-1',
      'Remember morning workout preference.',
    )

    expect(mockMemoryWriteFn).toHaveBeenCalledWith({
      characterId: 'char-1',
      sourceText: 'Remember morning workout preference.',
      sourceType: 'conversation',
    })
    expect(mockUpsertWikiEntries).toHaveBeenCalled()
    expect(mockUpsertAgentTasks).toHaveBeenCalled()
    expect(mockAppendMemoryEvents).toHaveBeenCalled()
    expect(mockUpsertDerivedSynonyms).toHaveBeenCalledWith([
      expect.objectContaining({ characterId: 'char-1', term: 'health' }),
    ])
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['memoryBundle', 'char-1'],
    })
  })
})

describe('triggerMemoryHeal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockMemoryHealFn.mockResolvedValue({
      data: {
        diff: {
          entries: [],
          tasks: [],
          events: [],
          synonyms: [],
        },
      },
    })
  })

  it('calls heal callable and invalidates memory cache', async () => {
    await triggerMemoryHeal('char-1')

    expect(mockMemoryHealFn).toHaveBeenCalledWith({ characterId: 'char-1' })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['memoryBundle', 'char-1'],
    })
  })
})