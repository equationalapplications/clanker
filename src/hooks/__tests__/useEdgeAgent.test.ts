import { renderHook, act } from '@testing-library/react-native'
import { useEdgeAgent } from '../useEdgeAgent'
import { createEdgeToolExecutors } from '~/services/edgeToolExecutors'
import type { IMessage } from 'react-native-gifted-chat'

const mockGenerateChatReply = jest.fn()
jest.mock('~/services/chatReplyService', () => ({
  generateChatReply: (...args: unknown[]) => mockGenerateChatReply(...args),
}))

jest.mock('~/services/clankerManifests', () => ({
  getSchemasForEdge: jest.fn((hasWiki: boolean, isCloudSynced: boolean) => {
    const schemas = [
      { name: 'get_current_time', description: 'Get current time', parameters: { type: 'object', properties: {}, required: [] } },
      { name: 'escalate_to_cloud_agent', description: 'Escalate to cloud', parameters: { type: 'object', properties: {}, required: [] } },
    ]
    if (hasWiki) {
      schemas.push({ name: 'wiki_read', description: 'Search memory', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } as never)
    }
    if (!isCloudSynced) {
      return schemas.filter((s) => s.name !== 'escalate_to_cloud_agent')
    }
    return schemas
  }),
}))

const mockExecutors = {
  get_current_time: jest.fn(() => 'Thursday, May 28, 2026 at 10:00 AM PDT'),
  wiki_read: jest.fn(async () => JSON.stringify({ facts: [{ content: 'User likes tea' }], tasks: [], events: [] })),
}
jest.mock('~/services/edgeToolExecutors', () => ({
  createEdgeToolExecutors: jest.fn(() => mockExecutors),
}))

jest.mock('~/services/CharacterPromptBuilder', () => ({
  buildSystemInstruction: () => 'You are Aria.',
  buildContentHistory: () => [],
}))

const mockIsDevSandboxEnabled = jest.fn(() => false)
jest.mock('~/auth/ensureDevSandboxCharacter', () => ({
  isDevSandboxEnabled: () => mockIsDevSandboxEnabled(),
  ensureDevSandboxCharacter: jest.fn(),
}))

const character = {
  id: 'char-1',
  name: 'Aria',
  appearance: 'warm',
  traits: 'kind',
  emotions: 'gentle',
  context: '',
}

const priorMessages: IMessage[] = []

const usageFields = {
  remainingCredits: 42,
  planTier: 'free',
  planStatus: 'active' as const,
  verifiedAt: '2026-06-24T00:00:00.000Z',
}

beforeEach(() => {
  jest.clearAllMocks()
  mockIsDevSandboxEnabled.mockReturnValue(false)
  process.env.EXPO_PUBLIC_CLOUD_AGENT_URL = ''
})

describe('useEdgeAgent', () => {
  it('escalates immediately in dev sandbox without calling generateReply', async () => {
    mockIsDevSandboxEnabled.mockReturnValue(true)
    process.env.EXPO_PUBLIC_CLOUD_AGENT_URL = 'http://localhost:8080'

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: false, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Hi there')
    })

    expect(response).toEqual({ escalated: true, usageSnapshot: null })
    expect(mockGenerateChatReply).not.toHaveBeenCalled()
    expect(result.current.escalationState).toBe('escalating')
    expect(result.current.isThinking).toBe(false)
  })

  it('returns escalated:false and text when the model returns a text reply with no functionCalls', async () => {
    mockGenerateChatReply.mockResolvedValue({ reply: 'Hello! How are you?', functionCalls: undefined, ...usageFields })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Hi there')
    })

    expect(response).toEqual({
      escalated: false,
      text: 'Hello! How are you?',
      usageSnapshot: usageFields,
    })
    expect(result.current.escalationState).toBe('idle')
  })

  it('executes get_current_time and loops to a final text reply', async () => {
    mockGenerateChatReply
      .mockResolvedValueOnce({ reply: '', functionCalls: [{ name: 'get_current_time', args: {} }], ...usageFields, remainingCredits: 41 })
      .mockResolvedValueOnce({ reply: 'It is Thursday.', functionCalls: undefined, ...usageFields })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('What time is it?')
    })

    expect(response).toEqual({
      escalated: false,
      text: 'It is Thursday.',
      usageSnapshot: usageFields,
    })
    expect(mockGenerateChatReply).toHaveBeenCalledTimes(2)
    expect(mockExecutors.get_current_time).toHaveBeenCalledWith({})
  })

  it('escalates when the model calls escalate_to_cloud_agent', async () => {
    mockGenerateChatReply.mockResolvedValue({ reply: '', functionCalls: [{ name: 'escalate_to_cloud_agent', args: {} }], ...usageFields })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Remind me to call mom tomorrow')
    })

    expect(response).toEqual({ escalated: true, usageSnapshot: usageFields })
    expect(result.current.escalationState).toBe('escalating')
  })

  it('ignores hallucinated escalate_to_cloud_agent for local-only characters', async () => {
    mockGenerateChatReply
      .mockResolvedValueOnce({ reply: '', functionCalls: [{ name: 'escalate_to_cloud_agent', args: {} }], ...usageFields })
      .mockResolvedValueOnce({ reply: 'Handled locally', functionCalls: undefined, ...usageFields })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: false, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Remind me to call mom tomorrow')
    })

    expect(response).toEqual({
      escalated: false,
      text: 'Handled locally',
      usageSnapshot: usageFields,
    })
    expect(result.current.escalationState).toBe('idle')
    expect(mockGenerateChatReply).toHaveBeenCalledTimes(2)
  })

  it('escalates automatically when MAX_ITERATIONS (5) is reached for cloud-synced characters', async () => {
    mockGenerateChatReply.mockResolvedValue({ reply: '', functionCalls: [{ name: 'get_current_time', args: {} }], ...usageFields })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Loop forever')
    })

    expect(response).toEqual({ escalated: true, usageSnapshot: usageFields })
    expect(result.current.escalationState).toBe('escalating')
    expect(mockGenerateChatReply).toHaveBeenCalledTimes(5)
  })

  it('returns no text (no escalation) when MAX_ITERATIONS is reached for local-only characters', async () => {
    mockGenerateChatReply.mockResolvedValue({ reply: '', functionCalls: [{ name: 'get_current_time', args: {} }], ...usageFields })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: false, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Loop forever')
    })

    expect(response).toEqual({ escalated: false, usageSnapshot: usageFields })
    expect(result.current.escalationState).toBe('idle')
    expect(mockGenerateChatReply).toHaveBeenCalledTimes(5)
  })

  it('escalates when generateChatReply throws, for cloud-synced characters', async () => {
    mockGenerateChatReply.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Hello')
    })

    expect(response).toEqual({ escalated: true, usageSnapshot: null })
  })

  it('isThinking is true during the call and false after it resolves', async () => {
    let resolveReply: (v: unknown) => void = () => {}
    mockGenerateChatReply.mockReturnValueOnce(new Promise((resolve) => { resolveReply = resolve }))

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    expect(result.current.isThinking).toBe(false)

    let done = false
    act(() => {
      void result.current.sendMessage('Hello').then(() => { done = true })
    })

    expect(result.current.isThinking).toBe(true)

    await act(async () => {
      resolveReply({ reply: 'Hi!', functionCalls: undefined, ...usageFields })
    })

    expect(result.current.isThinking).toBe(false)
    expect(done).toBe(true)
  })

  it('passes characterId and wiki to createEdgeToolExecutors', async () => {
    mockGenerateChatReply.mockResolvedValue({ reply: 'Hi!', functionCalls: undefined, ...usageFields })
    const mockWiki = { id: 'wiki-1' } as never

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: false, wiki: mockWiki }),
    )

    await act(async () => {
      await result.current.sendMessage('Hello')
    })

    expect(createEdgeToolExecutors).toHaveBeenCalledWith(character.id, mockWiki)
  })

  it('passes tools from getSchemasForEdge to generateChatReply', async () => {
    mockGenerateChatReply.mockResolvedValue({ reply: 'Hi!', functionCalls: undefined, ...usageFields })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    await act(async () => {
      await result.current.sendMessage('Hi')
    })

    const callArgs = mockGenerateChatReply.mock.calls[0][0]
    const names = (callArgs.tools as { name: string }[]).map((t) => t.name)
    expect(names).toContain('get_current_time')
    expect(names).toContain('escalate_to_cloud_agent')
  })
})
