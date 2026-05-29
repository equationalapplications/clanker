import { renderHook, act } from '@testing-library/react-native'
import { useEdgeAgent } from '../useEdgeAgent'
import { createEdgeToolExecutors } from '~/services/edgeToolExecutors'
import type { IMessage } from 'react-native-gifted-chat'

// Mock @google/genai
const mockGenerateContent = jest.fn()
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
}))

// Mock clankerManifests — useEdgeAgent now imports from here, not core-llm-tools
jest.mock('~/services/clankerManifests', () => ({
  clankerTimeSchema: { name: 'get_current_time', description: 'Get current time', parameters: {} },
  clankerEscalationSchema: { name: 'escalate_to_cloud_agent', description: 'Escalate to cloud', parameters: {} },
  clankerMemorySchema: {
    name: 'search_memory',
    description: 'Search memory',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
}))

// Mock edgeToolExecutors — factory returns a fixed executor map
jest.mock('~/services/edgeToolExecutors', () => ({
  createEdgeToolExecutors: jest.fn().mockReturnValue({
    get_current_time: () => 'Thursday, May 28, 2026 at 10:00 AM PDT',
    search_memory: async () => JSON.stringify({ facts: [{ content: 'User likes tea' }], tasks: [], events: [] }),
  }),
}))

// Mock characterPromptBuilder
jest.mock('~/services/CharacterPromptBuilder', () => ({
  buildSystemInstruction: () => 'You are Aria.',
  buildContentHistory: () => [],
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

beforeEach(() => {
  jest.clearAllMocks()
  process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'test-key'
})

afterEach(() => {
  delete process.env.EXPO_PUBLIC_GEMINI_API_KEY
})

describe('useEdgeAgent', () => {
  it('returns escalated:false and text when model returns a text response', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'Hello! How are you?',
      functionCalls: undefined,
    })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Hi there')
    })

    expect(response).toEqual({ escalated: false, text: 'Hello! How are you?' })
    expect(result.current.escalationState).toBe('idle')
  })

  it('returns escalated:true when model calls escalate_to_cloud_agent', async () => {
    mockGenerateContent.mockResolvedValue({
      text: undefined,
      functionCalls: [{ name: 'escalate_to_cloud_agent', args: {} }],
    })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Tell me about the French revolution')
    })

    expect(response?.escalated).toBe(true)
    expect(result.current.escalationState).toBe('escalating')
  })

  it('executes get_current_time tool and loops to get text reply', async () => {
    mockGenerateContent
      .mockResolvedValueOnce({
        text: undefined,
        functionCalls: [{ name: 'get_current_time', args: {} }],
      })
      .mockResolvedValueOnce({
        text: 'It is Thursday, May 28, 2026 at 10:00 AM PDT.',
        functionCalls: undefined,
      })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('What time is it?')
    })

    expect(response?.escalated).toBe(false)
    expect(response?.text).toContain('Thursday')
    expect(mockGenerateContent).toHaveBeenCalledTimes(2)
  })

  it('executes search_memory tool and loops to get text reply', async () => {
    mockGenerateContent
      .mockResolvedValueOnce({
        text: undefined,
        functionCalls: [{ name: 'search_memory', args: { query: 'tea' } }],
      })
      .mockResolvedValueOnce({
        text: 'I found that you like tea!',
        functionCalls: undefined,
      })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('What do I like to drink?')
    })

    expect(response?.escalated).toBe(false)
    expect(response?.text).toContain('tea')
    expect(mockGenerateContent).toHaveBeenCalledTimes(2)
  })

  it('escalates automatically when iteration cap is reached', async () => {
    mockGenerateContent.mockResolvedValue({
      text: undefined,
      functionCalls: [{ name: 'get_current_time', args: {} }],
    })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Loop forever')
    })

    expect(response?.escalated).toBe(true)
    expect(result.current.escalationState).toBe('escalating')
    expect(mockGenerateContent).toHaveBeenCalledTimes(5)
  })

  it('returns no text when iteration cap is reached for local-only characters', async () => {
    mockGenerateContent.mockResolvedValue({
      text: undefined,
      functionCalls: [{ name: 'get_current_time', args: {} }],
    })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: false, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Loop forever')
    })

    expect(response?.escalated).toBe(false)
    expect(response?.text).toBeUndefined()
    expect(result.current.escalationState).toBe('idle')
    expect(mockGenerateContent).toHaveBeenCalledTimes(5)
  })

  it('isThinking is true during the call and false after', async () => {
    let resolveGenerate: (v: any) => void
    const pendingGenerate = new Promise((resolve) => { resolveGenerate = resolve })
    mockGenerateContent.mockReturnValueOnce(pendingGenerate)

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    expect(result.current.isThinking).toBe(false)

    let done = false
    act(() => {
      result.current.sendMessage('Hello').then(() => { done = true })
    })

    expect(result.current.isThinking).toBe(true)

    await act(async () => {
      resolveGenerate!({ text: 'Hi!', functionCalls: undefined })
    })

    expect(result.current.isThinking).toBe(false)
    expect(done).toBe(true)
  })

  it('escalates when generateContent throws', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Hello')
    })

    expect(response?.escalated).toBe(true)
    expect(result.current.isThinking).toBe(false)
  })

  it('returns no text when generateContent throws for local-only characters', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: false, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Hello')
    })

    expect(response?.escalated).toBe(false)
    expect(response?.text).toBeUndefined()
    expect(result.current.isThinking).toBe(false)
  })

  it('escalates when EXPO_PUBLIC_GEMINI_API_KEY is not set', async () => {
    delete process.env.EXPO_PUBLIC_GEMINI_API_KEY

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Hello')
    })

    expect(response?.escalated).toBe(true)
    expect(mockGenerateContent).not.toHaveBeenCalled()
  })

  it('does not include escalate_to_cloud_agent or search_memory when wiki:null and isCloudSynced:false', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'Hello!',
      functionCalls: undefined,
    })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: false, wiki: null }),
    )

    await act(async () => {
      await result.current.sendMessage('Hi')
    })

    const callArgs = mockGenerateContent.mock.calls[0][0]
    const functionDeclarations = callArgs.config.tools[0].functionDeclarations as { name: string }[]
    const names = functionDeclarations.map((fd) => fd.name)
    expect(names).toContain('get_current_time')
    expect(names).not.toContain('search_memory')
    expect(names).not.toContain('escalate_to_cloud_agent')
  })

  it('includes escalate_to_cloud_agent but not search_memory when wiki:null and isCloudSynced:true', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'Hello!',
      functionCalls: undefined,
    })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    await act(async () => {
      await result.current.sendMessage('Hi')
    })

    const callArgs = mockGenerateContent.mock.calls[0][0]
    const functionDeclarations = callArgs.config.tools[0].functionDeclarations as { name: string }[]
    const names = functionDeclarations.map((fd) => fd.name)
    expect(names).toContain('get_current_time')
    expect(names).not.toContain('search_memory')
    expect(names).toContain('escalate_to_cloud_agent')
  })

  it('includes search_memory when wiki is provided', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'Hello!',
      functionCalls: undefined,
    })

    const mockWiki = {} as any
    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: false, wiki: mockWiki }),
    )

    await act(async () => {
      await result.current.sendMessage('Hi')
    })

    const callArgs = mockGenerateContent.mock.calls[0][0]
    const functionDeclarations = callArgs.config.tools[0].functionDeclarations as { name: string }[]
    const names = functionDeclarations.map((fd) => fd.name)
    expect(names).toContain('get_current_time')
    expect(names).toContain('search_memory')
    expect(names).not.toContain('escalate_to_cloud_agent')
  })

  it('passes wiki to createEdgeToolExecutors', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'Hi!', functionCalls: undefined })

    const mockWiki = { id: 'wiki-1' } as any
    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: false, wiki: mockWiki }),
    )

    await act(async () => {
      await result.current.sendMessage('Hello')
    })

    expect(createEdgeToolExecutors).toHaveBeenCalledWith(character.id, mockWiki)
  })
})
