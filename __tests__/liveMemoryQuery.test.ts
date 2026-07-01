import {
  buildLiveChatHandoff,
  buildMemoryQueryFromMessages,
  buildRecentChatContextFromMessages,
} from '~/services/liveMemoryQuery'

jest.mock('~/database/messageDatabase', () => ({
  getMessages: jest.fn(),
}))
jest.mock('~/database/characterDatabase', () => ({
  getCharacter: jest.fn(),
}))

import { getMessages } from '~/database/messageDatabase'
import { getCharacter } from '~/database/characterDatabase'

const mockGetMessages = jest.mocked(getMessages)
const mockGetCharacter = jest.mocked(getCharacter)

const sampleMessages = [
  {
    _id: '1',
    text: 'What is the weather?',
    createdAt: new Date('2026-01-01T10:00:00Z'),
    user: { _id: 'user-1' },
  },
  {
    _id: '2',
    text: 'It is sunny in Austin.',
    createdAt: new Date('2026-01-01T10:01:00Z'),
    user: { _id: 'char-1' },
  },
]

describe('buildMemoryQueryFromMessages', () => {
  test('returns empty string when there are no user messages', () => {
    expect(buildMemoryQueryFromMessages([], 'user-1')).toBe('')
  })

  test('returns user utterances without role labels', () => {
    expect(buildMemoryQueryFromMessages(sampleMessages, 'user-1')).toBe('What is the weather?')
  })

  test('joins multiple user turns from the recent window', () => {
    const messages = [
      {
        _id: '1',
        text: 'Search the news',
        createdAt: new Date('2026-01-01T10:00:00Z'),
        user: { _id: 'user-1' },
      },
      {
        _id: '2',
        text: 'Here is what I found.',
        createdAt: new Date('2026-01-01T10:01:00Z'),
        user: { _id: 'char-1' },
      },
      {
        _id: '3',
        text: 'Tell me more about the storm',
        createdAt: new Date('2026-01-01T10:02:00Z'),
        user: { _id: 'user-1' },
      },
    ]

    expect(buildMemoryQueryFromMessages(messages, 'user-1')).toBe(
      'Search the news\nTell me more about the storm',
    )
  })
})

describe('buildRecentChatContextFromMessages', () => {
  const userId = 'user-1'

  test('returns empty string when there are no messages', () => {
    expect(buildRecentChatContextFromMessages([], userId)).toBe('')
  })

  test('includes the most recent turns with user and character labels', () => {
    const query = buildRecentChatContextFromMessages(sampleMessages, userId, 'Frodo')

    expect(query).toBe('User: What is the weather?\nFrodo: It is sunny in Austin.')
  })

  test('truncates very long transcripts', () => {
    const query = buildRecentChatContextFromMessages(
      [
        {
          _id: '1',
          text: 'a'.repeat(3000),
          createdAt: new Date(),
          user: { _id: userId },
        },
      ],
      userId,
    )

    expect(query.length).toBe(2000)
  })
})

describe('buildLiveChatHandoff', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('returns distinct memoryQuery and recentChatContext', async () => {
    mockGetMessages.mockResolvedValue([
      {
        _id: '1',
        text: 'Search the news',
        createdAt: new Date(),
        user: { _id: 'user-1' },
      },
      {
        _id: '2',
        text: 'Here is what I found.',
        createdAt: new Date(),
        user: { _id: 'char-1' },
      },
    ])
    mockGetCharacter.mockResolvedValue({ name: 'Frodo' } as never)

    const handoff = await buildLiveChatHandoff('char-1', 'user-1')

    expect(handoff).toEqual({
      memoryQuery: 'Search the news',
      recentChatContext: 'User: Search the news\nFrodo: Here is what I found.',
    })
  })
})
