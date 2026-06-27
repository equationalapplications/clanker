import {
  mapFactSourceTypesForCloudSync,
  mapFactSourceTypesFromCloud,
  mapSourceTypeForCloudSync,
  mapSourceTypeFromCloud,
} from '~/services/wikiSourceType'

describe('wikiSourceType', () => {
  test('mapSourceTypeForCloudSync maps v4 values to legacy wikiSync values', () => {
    expect(mapSourceTypeForCloudSync('librarian_inferred')).toBe('agent_inferred')
    expect(mapSourceTypeForCloudSync('immutable_document')).toBe('user_document')
    expect(mapSourceTypeForCloudSync('user_stated')).toBe('user_stated')
    expect(mapSourceTypeForCloudSync(null)).toBeNull()
  })

  test('mapSourceTypeFromCloud maps legacy wikiSync values to v4 values', () => {
    expect(mapSourceTypeFromCloud('agent_inferred')).toBe('librarian_inferred')
    expect(mapSourceTypeFromCloud('user_document')).toBe('immutable_document')
    expect(mapSourceTypeFromCloud('user_confirmed')).toBe('user_confirmed')
    expect(mapSourceTypeFromCloud(null)).toBeNull()
  })

  test('mapFactSourceTypesForCloudSync maps fact arrays', () => {
    const facts = [
      { id: 'f1', source_type: 'librarian_inferred' as const },
      { id: 'f2', source_type: 'user_stated' as const },
    ]
    expect(mapFactSourceTypesForCloudSync(facts)).toEqual([
      { id: 'f1', source_type: 'agent_inferred' },
      { id: 'f2', source_type: 'user_stated' },
    ])
  })

  test('mapFactSourceTypesFromCloud maps fact arrays', () => {
    const facts = [
      { id: 'f1', source_type: 'agent_inferred' as const },
      { id: 'f2', source_type: 'immutable_document' as const },
    ]
    expect(mapFactSourceTypesFromCloud(facts)).toEqual([
      { id: 'f1', source_type: 'librarian_inferred' },
      { id: 'f2', source_type: 'immutable_document' },
    ])
  })
})
