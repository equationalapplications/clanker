const mockBuildFtsQuery = jest.fn()
const mockSearchEntries = jest.fn()
const mockGetRecentEntries = jest.fn()
const mockGetOpenTasks = jest.fn()
const mockGetRecentEvents = jest.fn()

jest.mock('~/database/ftsQueryBuilder', () => ({
  buildFtsQuery: (...args: unknown[]) => mockBuildFtsQuery(...args),
}))

jest.mock('~/database/wikiDatabase', () => ({
  searchEntries: (...args: unknown[]) => mockSearchEntries(...args),
  getRecentEntries: (...args: unknown[]) => mockGetRecentEntries(...args),
}), { virtual: true })

jest.mock('~/database/agentTaskDatabase', () => ({
  getOpenTasks: (...args: unknown[]) => mockGetOpenTasks(...args),
}), { virtual: true })

jest.mock('~/database/memoryEventDatabase', () => ({
  getRecentEvents: (...args: unknown[]) => mockGetRecentEvents(...args),
}), { virtual: true })

import { fetchMemoryBundle } from '~/services/memoryService'

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

    await expect(fetchMemoryBundle('char-1', 'running')).resolves.toEqual({
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
    expect(mockSearchEntries).toHaveBeenCalledWith('char-1', '"run"* OR "jog"*')
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

    await fetchMemoryBundle('char-1', 'the and but')

    expect(mockGetRecentEntries).toHaveBeenCalledWith('char-1', 10)
    expect(mockSearchEntries).not.toHaveBeenCalled()
  })
})