const mockGenerateImageFn = jest.fn()
let resolveAppCheck: (() => void) | null = null

jest.mock('~/config/firebaseConfig', () => ({
  get appCheckReady() {
    return new Promise<void>((resolve) => {
      resolveAppCheck = resolve
    })
  },
  generateImageFn: (...args: unknown[]) => mockGenerateImageFn(...args),
}))

import { generateImageViaCallable } from '~/services/imageGenerationService'

describe('generateImageViaCallable', () => {
  beforeEach(() => {
    mockGenerateImageFn.mockReset()
    resolveAppCheck = null
  })

  it('waits for App Check and calls callable with trimmed prompt', async () => {
    mockGenerateImageFn.mockResolvedValue({
      data: {
        imageBase64: 'YWJj',
        mimeType: 'image/webp',
        creditsSpent: 1,
        remainingCredits: 3,
        planTier: 'payg',
        planStatus: 'active',
        verifiedAt: '2026-01-01T00:00:00.000Z',
      },
    })

    const resultPromise = generateImageViaCallable('  hero portrait  ')

    expect(mockGenerateImageFn).not.toHaveBeenCalled()

    if (!resolveAppCheck) {
      throw new Error('Expected appCheckReady resolver to be set')
    }

    resolveAppCheck()
    const result = await resultPromise

    expect(mockGenerateImageFn).toHaveBeenCalledWith({ prompt: 'hero portrait' })
    expect(result).toEqual({
      imageBase64: 'YWJj',
      mimeType: 'image/webp',
      creditsSpent: 1,
      remainingCredits: 3,
      planTier: 'payg',
      planStatus: 'active',
      verifiedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('normalizes data URI responses to raw base64', async () => {
    mockGenerateImageFn.mockResolvedValue({
      data: {
        imageBase64: 'data:image/png;base64,Zm9vYmFy',
        mimeType: 'image/png',
        creditsSpent: 0,
        remainingCredits: null,
        planTier: 'monthly_20',
        planStatus: 'active',
        verifiedAt: '2026-01-01T00:00:00.000Z',
      },
    })

    const promise = generateImageViaCallable('wizard')
    if (!resolveAppCheck) {
      throw new Error('Expected appCheckReady resolver to be set')
    }
    resolveAppCheck()

    await expect(promise).resolves.toEqual({
      imageBase64: 'Zm9vYmFy',
      mimeType: 'image/png',
      creditsSpent: 0,
      remainingCredits: null,
      planTier: 'monthly_20',
      planStatus: 'active',
      verifiedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('rejects empty prompt before callable execution', async () => {
    await expect(generateImageViaCallable('   ')).rejects.toThrow(
      'prompt must be a non-empty string',
    )
    expect(mockGenerateImageFn).not.toHaveBeenCalled()
  })

  it('rejects invalid callable payload', async () => {
    mockGenerateImageFn.mockResolvedValue({ data: { mimeType: 'image/webp', creditsSpent: 1 } })

    const promise = generateImageViaCallable('astronaut')
    if (!resolveAppCheck) {
      throw new Error('Expected appCheckReady resolver to be set')
    }
    resolveAppCheck()

    await expect(promise).rejects.toThrow('Image generation returned empty image data')
  })

  it('rejects callable responses missing verifiedAt', async () => {
    mockGenerateImageFn.mockResolvedValue({
      data: {
        imageBase64: 'YWJj',
        mimeType: 'image/webp',
        creditsSpent: 1,
      },
    })

    const promise = generateImageViaCallable('astronaut')
    if (!resolveAppCheck) {
      throw new Error('Expected appCheckReady resolver to be set')
    }
    resolveAppCheck()

    await expect(promise).rejects.toThrow('Image generation returned invalid verifiedAt')
  })
})
