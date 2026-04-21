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
})
