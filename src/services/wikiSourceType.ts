/** Map client v4 source_type values to legacy wikiSync enum values. */
export function mapSourceTypeForCloudSync(
  sourceType: string | null | undefined,
): string | null | undefined {
  if (sourceType == null) return sourceType
  switch (sourceType) {
    case 'librarian_inferred':
      return 'agent_inferred'
    case 'immutable_document':
      return 'user_document'
    default:
      return sourceType
  }
}

/** Map legacy wikiSync source_type values to client v4 enum values. */
export function mapSourceTypeFromCloud(
  sourceType: string | null | undefined,
): string | null | undefined {
  if (sourceType == null) return sourceType
  switch (sourceType) {
    case 'agent_inferred':
      return 'librarian_inferred'
    case 'user_document':
      return 'immutable_document'
    default:
      return sourceType
  }
}

export function mapFactSourceTypesForCloudSync<T extends { source_type?: string | null }>(
  facts: T[],
): T[] {
  return facts.map((fact) => {
    const sourceType = mapSourceTypeForCloudSync(fact.source_type)
    if (sourceType === fact.source_type) return fact
    return { ...fact, source_type: sourceType }
  })
}

export function mapFactSourceTypesFromCloud<T extends { source_type?: string | null }>(
  facts: T[],
): T[] {
  return facts.map((fact) => {
    const sourceType = mapSourceTypeFromCloud(fact.source_type)
    if (sourceType === fact.source_type) return fact
    return { ...fact, source_type: sourceType }
  })
}
