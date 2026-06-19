const mockGenerateContent = jest.fn()
const mockGenerateReplyFn = jest.fn()
let resolveAppCheck: (() => void) | null = null

jest.mock('~/config/firebaseConfig', () => ({
  get appCheckReady() {
    return new Promise<void>((resolve) => {
      resolveAppCheck = resolve
    })
  },
  generateReplyFn: (...args: unknown[]) => mockGenerateReplyFn(...args),
}))

// Mock GoogleGenAI to avoid platform-specific import issues in tests
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
  Type: { OBJECT: 'object' },
}))

import { generateChatReply } from '~/services/chatReplyService'

describe('generateChatReply', () => {
  beforeEach(() => {
    mockGenerateReplyFn.mockReset()
    mockGenerateContent.mockReset()
    resolveAppCheck = null
  })

  it('waits for App Check and returns validated usage fields', async () => {
    mockGenerateReplyFn.mockResolvedValue({
      data: {
        reply: ' Hello ',
        remainingCredits: 6,
        planTier: 'payg',
        planStatus: 'active',
        verifiedAt: '2026-01-01T00:00:00.000Z',
      },
    })

    const resultPromise = generateChatReply({ prompt: '  hi  ', referenceId: 'abc' })
    expect(mockGenerateReplyFn).not.toHaveBeenCalled()

    if (!resolveAppCheck) {
      throw new Error('Expected appCheckReady resolver to be set')
    }
    resolveAppCheck()

    await expect(resultPromise).resolves.toEqual({
      reply: 'Hello',
      remainingCredits: 6,
      planTier: 'payg',
      planStatus: 'active',
      verifiedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(mockGenerateReplyFn).toHaveBeenCalledWith({ prompt: 'hi', referenceId: 'abc' })
  })

  it('forwards structured contents and systemInstruction to the callable payload', async () => {
    mockGenerateReplyFn.mockResolvedValue({
      data: {
        reply: 'Structured reply',
        verifiedAt: '2026-01-01T00:00:00.000Z',
      },
    })

    const resultPromise = generateChatReply({
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      systemInstruction: 'Be concise.',
      referenceId: 'abc',
    })

    if (!resolveAppCheck) {
      throw new Error('Expected appCheckReady resolver to be set')
    }
    resolveAppCheck()

    await expect(resultPromise).resolves.toEqual({
      reply: 'Structured reply',
      remainingCredits: null,
      planTier: null,
      planStatus: null,
      verifiedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(mockGenerateReplyFn).toHaveBeenCalledWith({
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      systemInstruction: 'Be concise.',
      referenceId: 'abc',
    })
  })

  it('rejects invalid structured payloads when contents are empty or missing systemInstruction', async () => {
    await expect(
      generateChatReply({ contents: [], systemInstruction: 'Tell a story.' }),
    ).rejects.toThrow('contents must be a non-empty array when provided')

    await expect(
      generateChatReply({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }),
    ).rejects.toThrow('systemInstruction must be a non-empty string when contents are provided')
  })

  it('rejects callable responses missing verifiedAt', async () => {
    mockGenerateReplyFn.mockResolvedValue({ data: { reply: 'hello' } })

    const resultPromise = generateChatReply({ prompt: 'hello' })
    if (!resolveAppCheck) {
      throw new Error('Expected appCheckReady resolver to be set')
    }
    resolveAppCheck()

    await expect(resultPromise).rejects.toThrow(
      'Invalid generateReply response payload: missing verifiedAt',
    )
  })

  it('rejects callable responses with whitespace-only verifiedAt', async () => {
    mockGenerateReplyFn.mockResolvedValue({
      data: {
        reply: 'hello',
        verifiedAt: '   ',
      },
    })

    const resultPromise = generateChatReply({ prompt: 'hello' })
    if (!resolveAppCheck) {
      throw new Error('Expected appCheckReady resolver to be set')
    }
    resolveAppCheck()

    await expect(resultPromise).rejects.toThrow(
      'Invalid generateReply response payload: missing verifiedAt',
    )
  })

  it('trims whitespace-padded verifiedAt and returns the normalized timestamp', async () => {
    mockGenerateReplyFn.mockResolvedValue({
      data: {
        reply: 'hello',
        verifiedAt: ' 2026-01-01T00:00:00.000Z ',
      },
    })

    const resultPromise = generateChatReply({ prompt: 'hello' })
    if (!resolveAppCheck) {
      throw new Error('Expected appCheckReady resolver to be set')
    }
    resolveAppCheck()

    await expect(resultPromise).resolves.toMatchObject({
      verifiedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('parses and forwards groundingMetadata when present', async () => {
    mockGenerateReplyFn.mockResolvedValue({
      data: {
        reply: 'Grounded reply',
        verifiedAt: '2026-01-01T00:00:00.000Z',
        groundingMetadata: {
          webSearchQueries: ['weather in Tokyo'],
          groundingChunks: [{ web: { uri: 'https://example.com', title: 'Example' } }],
          searchEntryPoint: { renderedContent: '<div>suggestions</div>' },
        },
      },
    })

    const resultPromise = generateChatReply({ prompt: 'weather', referenceId: 'abc' })
    if (!resolveAppCheck) {
      throw new Error('Expected appCheckReady resolver to be set')
    }
    resolveAppCheck()

    const result = await resultPromise
    expect(result.groundingMetadata).toEqual({
      webSearchQueries: ['weather in Tokyo'],
      groundingChunks: [{ web: { uri: 'https://example.com', title: 'Example' } }],
      searchEntryPoint: { renderedContent: '<div>suggestions</div>' },
    })
  })

  it('drops malformed groundingMetadata instead of throwing', async () => {
    mockGenerateReplyFn.mockResolvedValue({
      data: {
        reply: 'Reply',
        verifiedAt: '2026-01-01T00:00:00.000Z',
        groundingMetadata: 'not-an-object',
      },
    })

    const resultPromise = generateChatReply({ prompt: 'hello' })
    if (!resolveAppCheck) {
      throw new Error('Expected appCheckReady resolver to be set')
    }
    resolveAppCheck()

    const result = await resultPromise
    expect(result.groundingMetadata).toBeUndefined()
  })

  it('drops groundingMetadata when present but empty of recognized fields', async () => {
    mockGenerateReplyFn.mockResolvedValue({
      data: {
        reply: 'Reply',
        verifiedAt: '2026-01-01T00:00:00.000Z',
        groundingMetadata: { unrelatedField: 123 },
      },
    })

    const resultPromise = generateChatReply({ prompt: 'hello' })
    if (!resolveAppCheck) {
      throw new Error('Expected appCheckReady resolver to be set')
    }
    resolveAppCheck()

    const result = await resultPromise
    expect(result.groundingMetadata).toBeUndefined()
  })

  describe('mock auth branch (EXPO_PUBLIC_USE_MOCK_AUTH)', () => {
    const originalEnv = process.env.EXPO_PUBLIC_USE_MOCK_AUTH

    beforeEach(() => {
      process.env.EXPO_PUBLIC_USE_MOCK_AUTH = 'true'
      process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'test-api-key'
      ;(global as { __DEV__?: boolean }).__DEV__ = true
      mockGenerateContent.mockResolvedValue({
        functionCalls: null,
        text: '[MOCKED FALLBACK] Edge agent did not escalate. Local simulated response.',
      })
    })

    afterEach(() => {
      process.env.EXPO_PUBLIC_USE_MOCK_AUTH = originalEnv
      delete process.env.EXPO_PUBLIC_GEMINI_API_KEY
      delete (global as { __DEV__?: boolean }).__DEV__
    })

    it('returns mock response without calling generateReplyFn', async () => {
      const result = await generateChatReply({ prompt: 'hello' })

      expect(mockGenerateReplyFn).not.toHaveBeenCalled()
      expect(result.reply).toBe('[MOCKED FALLBACK] Edge agent did not escalate. Local simulated response.')
      // No credits are spent when the edge agent handles locally, so the usage snapshot should not override UI state.
      expect(result.remainingCredits).toBeNull()
      expect(result.planTier).toBeNull()
      expect(result.planStatus).toBeNull()
      expect(result.verifiedAt).toBeTruthy()
    })

    it('returns mock response with structured contents', async () => {
      const result = await generateChatReply({
        contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
        systemInstruction: 'Be helpful.',
      })

      expect(mockGenerateReplyFn).not.toHaveBeenCalled()
      expect(result.reply).toBe('[MOCKED FALLBACK] Edge agent did not escalate. Local simulated response.')
    })

    describe('escalated path (escalate_to_cloud_agent function call)', () => {
      const mockFetch = jest.fn()

      beforeEach(() => {
        process.env.EXPO_PUBLIC_CLOUD_AGENT_URL = 'http://localhost:8080'
        global.fetch = mockFetch
        mockGenerateContent.mockResolvedValue({
          functionCalls: [{ name: 'escalate_to_cloud_agent' }],
          text: '',
        })
      })

      afterEach(() => {
        delete process.env.EXPO_PUBLIC_CLOUD_AGENT_URL
        mockFetch.mockReset()
      })

      it('POSTs to /agent/run and maps cloud response', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            reply: 'Cloud reply',
            usageSnapshot: { remainingCredits: 5 },
          }),
        })

        const result = await generateChatReply({ prompt: 'hello', characterId: 'char-1' })

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8080/agent/run',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer mock_token_123',
              'X-Timezone': expect.any(String),
            },
            body: JSON.stringify({ message: 'hello', characterId: 'char-1' }),
          },
        )
        expect(result).toEqual({
          reply: 'Cloud reply',
          remainingCredits: 5,
          planTier: 'free',
          planStatus: 'active',
          verifiedAt: expect.any(String),
        })
      })

      it('throws CLOUD_AGENT_INSUFFICIENT_CREDITS on 402', async () => {
        mockFetch.mockResolvedValue({ ok: false, status: 402 })

        await expect(
          generateChatReply({ prompt: 'hello', characterId: 'char-1' }),
        ).rejects.toThrow('CLOUD_AGENT_INSUFFICIENT_CREDITS')
      })
    })
  })
})
