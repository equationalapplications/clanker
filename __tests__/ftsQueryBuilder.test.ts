const mockGetDerivedSynonyms = jest.fn()

jest.mock('~/database/derivedSynonymDatabase', () => ({
  getDerivedSynonyms: (...args: unknown[]) => mockGetDerivedSynonyms(...args),
}), { virtual: true })

import { buildFtsQuery } from '~/database/ftsQueryBuilder'

describe('buildFtsQuery', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetDerivedSynonyms.mockResolvedValue([])
  })

  it('returns null for empty or punctuation-only input', async () => {
    await expect(buildFtsQuery('', 'char-1')).resolves.toBeNull()
    await expect(buildFtsQuery('!!! ???', 'char-1')).resolves.toBeNull()
  })

  it('returns null when only stopwords survive sanitization', async () => {
    await expect(buildFtsQuery('the and but for with', 'char-1')).resolves.toBeNull()
  })

  it('builds quoted OR query with sanitized tokens and derived synonyms', async () => {
    mockGetDerivedSynonyms.mockResolvedValue([
      {
        term: 'run',
        synonyms: ['jog'],
      },
    ])

    await expect(buildFtsQuery('Running plan!!!', 'char-1')).resolves.toBe(
      '"run"* OR "jog"* OR "plan"*',
    )
  })

  it('lemmatizes plural nouns', async () => {
    await expect(buildFtsQuery('marriages', 'char-1')).resolves.toBe('"marriage"*')
  })
})