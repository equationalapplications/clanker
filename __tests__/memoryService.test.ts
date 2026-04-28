const mockBuildFtsQuery = jest.fn()
const mockSearchEntries = jest.fn()
const mockGetRecentEntries = jest.fn()
const mockGetOpenTasks = jest.fn()
const mockGetOpenTasksForHeal = jest.fn()
const mockGetEntriesForHeal = jest.fn()
const mockGetRecentEvents = jest.fn()
const mockCountEntries = jest.fn()
const mockUpsertWikiEntries = jest.fn()
const mockSoftDeleteWikiEntries = jest.fn()
const mockSoftDeleteAllWikiEntries = jest.fn()
const mockSoftDeleteWikiEntriesBySourceRef = jest.fn()
const mockUpsertAgentTasks = jest.fn()
const mockSoftDeleteAgentTasks = jest.fn()
const mockSoftDeleteAllAgentTasks = jest.fn()
const mockAppendMemoryEvents = jest.fn()
const mockUpsertDerivedSynonyms = jest.fn()
const mockMemoryWriteFn = jest.fn()
const mockMemoryHealFn = jest.fn()
const mockMemoryReadFn = jest.fn()
const mockMemoryForgetFn = jest.fn()
const mockInvalidateQueries = jest.fn()

jest.mock('~/database/ftsQueryBuilder', () => ({
  buildFtsQuery: (...args: unknown[]) => mockBuildFtsQuery(...args),
}))

jest.mock('~/database/wikiDatabase', () => ({
  searchEntries: (...args: unknown[]) => mockSearchEntries(...args),
  getRecentEntries: (...args: unknown[]) => mockGetRecentEntries(...args),
  countEntries: (...args: unknown[]) => mockCountEntries(...args),
  upsertWikiEntries: (...args: unknown[]) => mockUpsertWikiEntries(...args),
  softDeleteWikiEntries: (...args: unknown[]) => mockSoftDeleteWikiEntries(...args),
  softDeleteAllWikiEntries: (...args: unknown[]) => mockSoftDeleteAllWikiEntries(...args),
  softDeleteWikiEntriesBySourceRef: (...args: unknown[]) => mockSoftDeleteWikiEntriesBySourceRef(...args),
  getEntriesForHeal: (...args: unknown[]) => mockGetEntriesForHeal(...args),
}), { virtual: true })

jest.mock('~/database/agentTaskDatabase', () => ({
  getOpenTasks: (...args: unknown[]) => mockGetOpenTasks(...args),
  upsertAgentTasks: (...args: unknown[]) => mockUpsertAgentTasks(...args),
  softDeleteAgentTasks: (...args: unknown[]) => mockSoftDeleteAgentTasks(...args),
  softDeleteAllAgentTasks: (...args: unknown[]) => mockSoftDeleteAllAgentTasks(...args),
  getOpenTasksForHeal: (...args: unknown[]) => mockGetOpenTasksForHeal(...args),
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
  memoryReadFn: (...args: unknown[]) => mockMemoryReadFn(...args),
  memoryForgetFn: (...args: unknown[]) => mockMemoryForgetFn(...args),
}))

jest.mock('~/config/queryClient', () => ({
  queryClient: {
    invalidateQueries: (...args: unknown[]) => mockInvalidateQueries(...args),
  },
}))

import { fetchMemoryBundle, triggerMemoryWrite, triggerMemoryHeal, triggerMemoryRead, forgetMemory } from '~/services/memoryService'
import type { Character } from '~/services/aiChatService'

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
      queryKey: ['memoryBundle', 'char-1', 'user-1'],
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
    mockGetEntriesForHeal.mockResolvedValue([])
    mockGetOpenTasksForHeal.mockResolvedValue([])
    await triggerMemoryHeal('char-1', 'user-1')

    expect(mockMemoryHealFn).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: 'char-1' }),
    )
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['memoryBundle', 'char-1', 'user-1'],
    })
  })
})

describe('triggerMemoryRead', () => {
  const cloudCharacter = {
    id: 'char-1',
    name: 'Nova',
    appearance: '',
    traits: '',
    emotions: '',
    context: '',
    cloud_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockCountEntries.mockResolvedValue(0)
    mockMemoryReadFn.mockResolvedValue({
      data: { entries: [], tasks: [], events: [], synonyms: [] },
    })
  })

  it('does nothing when character has no cloud_id', async () => {
    await triggerMemoryRead({ id: 'char_123_abc', name: 'Nova', appearance: '', traits: '', emotions: '', context: '' }, 'user-1')

    expect(mockCountEntries).not.toHaveBeenCalled()
    expect(mockMemoryReadFn).not.toHaveBeenCalled()
  })

  it('does nothing when local wiki already has entries', async () => {
    mockCountEntries.mockResolvedValue(5)

    await triggerMemoryRead(cloudCharacter, 'user-1')

    expect(mockMemoryReadFn).not.toHaveBeenCalled()
  })

  it('calls memoryRead and applies diff when wiki is empty', async () => {
    mockMemoryReadFn.mockResolvedValue({
      data: {
        entries: [{ id: 'e1', characterId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', userId: 'user-1', title: 'Fact', body: 'Body', tags: [], confidence: 'certain', sourceType: 'user_stated' }],
        tasks: [],
        events: [],
        synonyms: [],
      },
    })

    await triggerMemoryRead(cloudCharacter, 'user-1')

    expect(mockCountEntries).toHaveBeenCalledWith('user-1', 'char-1')
    expect(mockMemoryReadFn).toHaveBeenCalledWith({ characterId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
    expect(mockUpsertWikiEntries).toHaveBeenCalled()
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['memoryBundle', 'char-1', 'user-1'] })
  })
})

describe('forgetMemory', () => {
  const localCharacter = { id: 'char_local', cloud_id: null, name: 'Nova', appearance: '', traits: '', emotions: '', context: '' }
  const cloudCharacter = { id: 'char_local', cloud_id: '550e8400-e29b-41d4-a716-446655440000', name: 'Nova', appearance: '', traits: '', emotions: '', context: '' }

  beforeEach(() => {
    jest.clearAllMocks()
    mockSoftDeleteWikiEntries.mockResolvedValue(1)
    mockSoftDeleteAllWikiEntries.mockResolvedValue(3)
    mockSoftDeleteAgentTasks.mockResolvedValue(0)
    mockSoftDeleteAllAgentTasks.mockResolvedValue(1)
    mockMemoryForgetFn.mockResolvedValue({ data: { success: true } })
  })

  it('soft-deletes specified entries locally by id', async () => {
    await forgetMemory(localCharacter, 'user-1', { entryIds: ['e1', 'e2'] })
    expect(mockSoftDeleteWikiEntries).toHaveBeenCalledWith('char_local', 'user-1', ['e1', 'e2'])
    expect(mockSoftDeleteAgentTasks).not.toHaveBeenCalled()
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['memoryBundle', 'char_local', 'user-1'] })
  })

  it('soft-deletes all entries locally when clearAll is true', async () => {
    await forgetMemory(localCharacter, 'user-1', { clearAll: true })
    expect(mockSoftDeleteAllWikiEntries).toHaveBeenCalledWith('char_local', 'user-1')
    expect(mockSoftDeleteAllAgentTasks).toHaveBeenCalledWith('char_local', 'user-1')
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['memoryBundle', 'char_local', 'user-1'] })
  })

  it('does not call cloud forget for local-only characters', async () => {
    await forgetMemory(localCharacter, 'user-1', { entryIds: ['e1'] })
    expect(mockMemoryForgetFn).not.toHaveBeenCalled()
  })

  it('calls cloud forget for characters with cloud_id', async () => {
    await forgetMemory(cloudCharacter, 'user-1', { entryIds: ['e1'] })
    expect(mockMemoryForgetFn).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: '550e8400-e29b-41d4-a716-446655440000', entryIds: ['e1'] }),
    )
  })

  it('soft-deletes by sourceRef locally and passes sourceRef to cloud callable', async () => {
    const mockSoftDeleteBySourceRef = mockSoftDeleteWikiEntriesBySourceRef // from jest.mock
    mockSoftDeleteBySourceRef.mockResolvedValue(undefined)
    mockMemoryForgetFn.mockResolvedValue({ data: {} })

    const character: Character = { id: 'local-1', cloud_id: '550e8400-e29b-41d4-a716-446655440001', name: 'TestChar' } as any

    await forgetMemory(character, 'user-1', { sourceRef: 'notes.md' })

    expect(mockSoftDeleteBySourceRef).toHaveBeenCalledWith('local-1', 'user-1', 'notes.md')
    expect(mockMemoryForgetFn).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: '550e8400-e29b-41d4-a716-446655440001', sourceRef: 'notes.md' }),
    )
  })
})