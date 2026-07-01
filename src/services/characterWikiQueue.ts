export type CharacterWikiOperation = 'reading' | 'writing' | 'ingesting' | 'forgetting' | 'syncing'

const emptyOperationTail = (): Record<CharacterWikiOperation, Promise<void>> => ({
  reading: Promise.resolve(),
  writing: Promise.resolve(),
  ingesting: Promise.resolve(),
  forgetting: Promise.resolve(),
  syncing: Promise.resolve(),
})

/** Per-entity queues so concurrent hook instances share one serialized chain per op. */
const entityOperationQueues = new Map<string, Record<CharacterWikiOperation, Promise<void>>>()

export function tailForEntity(entityId: string) {
  let tail = entityOperationQueues.get(entityId)
  if (!tail) {
    tail = emptyOperationTail()
    entityOperationQueues.set(entityId, tail)
  }
  return tail
}

/** For tests only — clears cross-hook serialization state. */
export function resetCharacterWikiEntityQueuesForTests() {
  entityOperationQueues.clear()
}

/**
 * Wait until all in-flight wiki writes for this character have finished.
 * Used before live-voice memory sync so exportDump sees the latest observations.
 *
 * Note: observations dispatched after this snapshot (e.g. fire-and-forget from Chat)
 * are not included until the next sync.
 */
export function awaitPendingWikiWrites(entityId: string): Promise<void> {
  const tail = entityOperationQueues.get(entityId)
  if (!tail) return Promise.resolve()
  return tail.writing
}
