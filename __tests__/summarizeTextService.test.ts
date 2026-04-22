const mockSummarizeTextFn = jest.fn()
let resolveAppCheck: (() => void) | null = null

jest.mock('~/config/firebaseConfig', () => ({
  get appCheckReady() {
    return new Promise<void>((resolve) => {
      resolveAppCheck = resolve
    })
  },
  summarizeTextFn: (...args: unknown[]) => mockSummarizeTextFn(...args),
}))

import { summarizeText } from '~/services/summarizeTextService'

describe('summarizeText', () => {
  beforeEach(() => {
    mockSummarizeTextFn.mockReset()
    resolveAppCheck = null
  })

  it('waits for App Check and returns summary text', async () => {
    mockSummarizeTextFn.mockResolvedValue({
      data: {
        summary: ' concise summary ',
      },
    })

    const resultPromise = summarizeText({
      text: '  chat transcript  ',
      maxCharacters: 4000,
    })
    expect(mockSummarizeTextFn).not.toHaveBeenCalled()

    if (!resolveAppCheck) {
      throw new Error('Expected appCheckReady resolver to be set')
    }
    resolveAppCheck()

    await expect(resultPromise).resolves.toBe('concise summary')
    expect(mockSummarizeTextFn).toHaveBeenCalledWith({
      text: 'chat transcript',
      maxCharacters: 4000,
    })
  })

  it('rejects invalid callable responses', async () => {
    mockSummarizeTextFn.mockResolvedValue({ data: { summary: '' } })
    const resultPromise = summarizeText({ text: 'hello', maxCharacters: 100 })

    if (!resolveAppCheck) {
      throw new Error('Expected appCheckReady resolver to be set')
    }
    resolveAppCheck()

    await expect(resultPromise).rejects.toThrow('Invalid summarizeText response payload')
  })
})
