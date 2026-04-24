const mockGenerateVoiceReplyFn = jest.fn()
let resolveAppCheck: (() => void) | null = null

jest.mock('~/config/firebaseConfig', () => ({
  get appCheckReady() {
    return new Promise<void>((resolve) => {
      resolveAppCheck = resolve
    })
  },
  generateVoiceReplyFn: (...args: unknown[]) => mockGenerateVoiceReplyFn(...args),
}))

import { generateVoiceReply } from '~/services/voiceReplyService'

describe('generateVoiceReply', () => {
  beforeEach(() => {
    mockGenerateVoiceReplyFn.mockReset()
    resolveAppCheck = null
  })

  it('waits for App Check and returns validated payload', async () => {
    mockGenerateVoiceReplyFn.mockResolvedValue({
      data: {
        replyText: ' Hello ',
        rawReplyText: ' [laughs] Hello ',
        audioBase64: 'UklGRiQAAABXQVZFZm10',
        audioMimeType: 'audio/wav',
        remainingCredits: 8,
        planTier: 'payg',
        planStatus: 'active',
        verifiedAt: '2026-04-23T00:00:00.000Z',
      },
    })

    const resultPromise = generateVoiceReply({
      prompt: '  hi  ',
      characterVoice: 'Kore',
      characterTraits: 'kind',
      characterEmotions: 'happy',
      referenceId: 'msg-1',
    })

    expect(mockGenerateVoiceReplyFn).not.toHaveBeenCalled()

    if (!resolveAppCheck) {
      throw new Error('Expected appCheckReady resolver to be set')
    }
    resolveAppCheck()

    await expect(resultPromise).resolves.toEqual({
      replyText: 'Hello',
      rawReplyText: '[laughs] Hello',
      audioBase64: 'UklGRiQAAABXQVZFZm10',
      audioMimeType: 'audio/wav',
      remainingCredits: 8,
      planTier: 'payg',
      planStatus: 'active',
      verifiedAt: '2026-04-23T00:00:00.000Z',
    })

    expect(mockGenerateVoiceReplyFn).toHaveBeenCalledWith({
      prompt: 'hi',
      characterVoice: 'Kore',
      characterTraits: 'kind',
      characterEmotions: 'happy',
      referenceId: 'msg-1',
    })
  })

  it('rejects invalid callable payload', async () => {
    mockGenerateVoiceReplyFn.mockResolvedValue({
      data: {
        replyText: 'hello',
      },
    })

    const resultPromise = generateVoiceReply({
      prompt: 'hello',
      characterVoice: 'Kore',
    })

    if (!resolveAppCheck) {
      throw new Error('Expected appCheckReady resolver to be set')
    }
    resolveAppCheck()

    await expect(resultPromise).rejects.toThrow('Invalid generateVoiceReply response payload')
  })
})
