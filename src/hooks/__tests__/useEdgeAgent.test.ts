import { renderHook, act } from '@testing-library/react-native'
import { useEdgeAgent } from '../useEdgeAgent'
import type { IMessage } from 'react-native-gifted-chat'

// Mock @google/genai
const mockGenerateContent = jest.fn()
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
}))

// Mock core-llm-tools so schema imports work
jest.mock('@equationalapplications/core-llm-tools', () => ({
  getCurrentTimeManifest: {
    schema: { name: 'get_current_time', description: 'Get current time', parameters: {} },
  },
  escalateToCloudManifest: {
    schema: { name: 'escalate_to_cloud', description: 'Escalate to cloud', parameters: {} },
  },
}))

// Mock edgeToolExecutors
jest.mock('~/services/edgeToolExecutors', () => ({
  edgeToolExecutors: {
    get_current_time: () => 'Thursday, May 28, 2026 at 10:00 AM PDT',
  },
}))

// Mock characterPromptBuilder
jest.mock('~/services/characterPromptBuilder', () => ({
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
      useEdgeAgent({ character, userId: 'u1', priorMessages }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Hi there')
    })

    expect(response).toEqual({ escalated: false, text: 'Hello! How are you?' })
    expect(result.current.escalationState).toBe('idle')
  })

  it('returns escalated:true when model calls escalate_to_cloud', async () => {
    mockGenerateContent.mockResolvedValue({
      text: undefined,
      functionCalls: [{ name: 'escalate_to_cloud', args: {} }],
    })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages }),
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
      useEdgeAgent({ character, userId: 'u1', priorMessages }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('What time is it?')
    })

    expect(response?.escalated).toBe(false)
    expect(response?.text).toContain('Thursday')
    expect(mockGenerateContent).toHaveBeenCalledTimes(2)
  })

  it('escalates automatically when iteration cap is reached', async () => {
    // Always return a function call — never a text response
    mockGenerateContent.mockResolvedValue({
      text: undefined,
      functionCalls: [{ name: 'get_current_time', args: {} }],
    })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Loop forever')
    })

    expect(response?.escalated).toBe(true)
    expect(result.current.escalationState).toBe('escalating')
    expect(mockGenerateContent).toHaveBeenCalledTimes(5) // MAX_ITERATIONS
  })

  it('isThinking is true during the call and false after', async () => {
    let resolveGenerate: (v: any) => void
    const pendingGenerate = new Promise((resolve) => { resolveGenerate = resolve })
    mockGenerateContent.mockReturnValueOnce(pendingGenerate)

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages }),
    )

    expect(result.current.isThinking).toBe(false)

    let done = false
    act(() => {
      result.current.sendMessage('Hello').then(() => { done = true })
    })

    // isThinking should be true while pending
    expect(result.current.isThinking).toBe(true)

    await act(async () => {
      resolveGenerate!({ text: 'Hi!', functionCalls: undefined })
    })

    expect(result.current.isThinking).toBe(false)
    expect(done).toBe(true)
  })

  it('escalates when EXPO_PUBLIC_GEMINI_API_KEY is not set', async () => {
    delete process.env.EXPO_PUBLIC_GEMINI_API_KEY

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Hello')
    })

    expect(response?.escalated).toBe(true)
    expect(mockGenerateContent).not.toHaveBeenCalled()
  })
})
