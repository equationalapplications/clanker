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

import { generateChatReply } from '~/services/chatReplyService'

describe('generateChatReply', () => {
  beforeEach(() => {
    mockGenerateReplyFn.mockReset()
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

  it('drops malformed groundingChunks entries', async () => {
    mockGenerateReplyFn.mockResolvedValue({
      data: {
        reply: 'Reply',
        verifiedAt: '2026-01-01T00:00:00.000Z',
        groundingMetadata: { groundingChunks: [null, { web: { uri: 'https://example.com' } }] },
      },
    })

    const resultPromise = generateChatReply({ prompt: 'hello' })
    if (!resolveAppCheck) {
      throw new Error('Expected appCheckReady resolver to be set')
    }
    resolveAppCheck()

    const result = await resultPromise
    expect(result.groundingMetadata?.groundingChunks).toEqual([{ web: { uri: 'https://example.com' } }])
  })
})
