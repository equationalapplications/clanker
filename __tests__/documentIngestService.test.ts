const mockAppCheckReady = Promise.resolve()
const mockDocumentExtractFn = jest.fn()

jest.mock('~/config/firebaseConfig', () => ({
  appCheckReady: mockAppCheckReady,
  documentExtractFn: (...args: unknown[]) => mockDocumentExtractFn(...args),
}))

import { extractDocument } from '~/services/documentIngestService'

describe('extractDocument', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns parsed facts from callable response', async () => {
    mockDocumentExtractFn.mockResolvedValue({
      data: {
        facts: [
          { title: 'Test', body: 'Test body.', tags: ['test'], confidence: 'certain' },
        ],
        contentHash: 'a'.repeat(64),
        truncated: false,
      },
    })

    const result = await extractDocument({
      characterId: 'char-1',
      filename: 'notes.md',
      content: 'Hello world',
      contentHash: 'b'.repeat(64),
    })

    expect(result.facts).toHaveLength(1)
    expect(result.facts[0].title).toBe('Test')
    expect(result.contentHash).toBe('a'.repeat(64))
    expect(result.truncated).toBe(false)
  })

  it('drops facts with invalid confidence', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    mockDocumentExtractFn.mockResolvedValue({
      data: {
        facts: [
          { title: 'Valid', body: 'Valid body.', tags: [], confidence: 'certain' },
          { title: 'Bad', body: 'Bad body.', tags: [], confidence: 'made_up' },
        ],
        contentHash: 'a'.repeat(64),
        truncated: false,
      },
    })

    const result = await extractDocument({
      characterId: 'char-1',
      filename: 'notes.md',
      content: 'Hello',
      contentHash: 'b'.repeat(64),
    })

    expect(result.facts).toHaveLength(1)
    expect(result.facts[0].title).toBe('Valid')
  })

  it('omits characterId from callable payload when null (local-only character)', async () => {
    mockDocumentExtractFn.mockResolvedValue({
      data: {
        facts: [],
        contentHash: 'a'.repeat(64),
        truncated: false,
      },
    })

    await extractDocument({
      characterId: null,
      filename: 'notes.md',
      content: 'Hello',
      contentHash: 'd'.repeat(64),
    })

    expect(mockDocumentExtractFn).toHaveBeenCalledTimes(1)
    const payload = mockDocumentExtractFn.mock.calls[0][0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('characterId')
    expect(payload.filename).toBe('notes.md')
    expect(payload.content).toBe('Hello')
    expect(payload.contentHash).toBe('d'.repeat(64))
  })

  it('includes characterId in callable payload when provided', async () => {
    mockDocumentExtractFn.mockResolvedValue({
      data: {
        facts: [],
        contentHash: 'a'.repeat(64),
        truncated: false,
      },
    })

    await extractDocument({
      characterId: 'uuid-1234',
      filename: 'notes.md',
      content: 'Hello',
      contentHash: 'e'.repeat(64),
    })

    expect(mockDocumentExtractFn).toHaveBeenCalledTimes(1)
    const payload = mockDocumentExtractFn.mock.calls[0][0] as Record<string, unknown>
    expect(payload.characterId).toBe('uuid-1234')
  })

  it('falls back to input hash when server hash is invalid', async () => {
    mockDocumentExtractFn.mockResolvedValue({
      data: {
        facts: [],
        contentHash: 'not-a-valid-hash',
        truncated: true,
      },
    })

    const result = await extractDocument({
      characterId: 'char-1',
      filename: 'notes.md',
      content: 'Hello',
      contentHash: 'c'.repeat(64),
    })

    expect(result.contentHash).toBe('c'.repeat(64))
    expect(result.truncated).toBe(true)
  })
})
