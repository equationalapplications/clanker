jest.mock('~/auth/ensureDevSandboxCharacter', () => ({
  isDevSandboxEnabled: jest.fn(() => false),
}))

jest.mock('~/services/apiClient', () => ({
  wikiLlm: jest.fn(),
  generateEmbedding: jest.fn(),
}))

import { isDevSandboxEnabled } from '~/auth/ensureDevSandboxCharacter'
import { wikiLlm, generateEmbedding } from '~/services/apiClient'
import { createWikiLlmProvider } from '~/services/wikiLlmProvider'

const mockIsDevSandboxEnabled = isDevSandboxEnabled as jest.MockedFunction<typeof isDevSandboxEnabled>
const mockWikiLlm = wikiLlm as jest.MockedFunction<typeof wikiLlm>
const mockGenerateEmbedding = generateEmbedding as jest.MockedFunction<typeof generateEmbedding>

describe('createWikiLlmProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsDevSandboxEnabled.mockReturnValue(false)
  })

  it('uses Firebase callables in production mode', async () => {
    mockWikiLlm.mockResolvedValue({ data: { text: '{"facts":[]}' } } as never)
    mockGenerateEmbedding.mockResolvedValue({ data: { embedding: [0.1, 0.2] } } as never)

    const provider = createWikiLlmProvider()
    await provider.generateText({ systemPrompt: 'sys', userPrompt: 'user' })
    await provider.embed('hello')

    expect(mockWikiLlm).toHaveBeenCalledWith({ systemPrompt: 'sys', userPrompt: 'user' })
    expect(mockGenerateEmbedding).toHaveBeenCalledWith({
      text: 'hello',
      taskType: 'SEMANTIC_SIMILARITY',
    })
  })

  it('uses local stubs in dev sandbox without Firebase auth', async () => {
    mockIsDevSandboxEnabled.mockReturnValue(true)

    const provider = createWikiLlmProvider()
    const text = await provider.generateText({ systemPrompt: 'sys', userPrompt: 'user' })
    const embedding = await provider.embed('hello world')

    expect(mockWikiLlm).not.toHaveBeenCalled()
    expect(mockGenerateEmbedding).not.toHaveBeenCalled()
    expect(JSON.parse(text)).toEqual({ facts: [], tasks: [] })
    expect(embedding).toHaveLength(768)
    expect(embedding.some((value) => value !== 0)).toBe(true)
  })
})
