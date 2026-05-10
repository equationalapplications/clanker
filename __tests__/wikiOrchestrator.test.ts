import { wikiOrchestrator, _resetWikiOrchestratorForTests } from '~/services/wikiOrchestrator'

const makeWikiMock = () => ({
  read: jest.fn().mockResolvedValue(null),
  write: jest.fn().mockResolvedValue(undefined),
  ingestDocument: jest.fn().mockResolvedValue(undefined),
  forget: jest.fn().mockResolvedValue(undefined),
  exportDump: jest.fn().mockResolvedValue({ generatedAt: 0, entities: {} }),
  importDump: jest.fn().mockResolvedValue(undefined),
  runPrune: jest.fn().mockResolvedValue(undefined),
  subscribeEntityStatus: jest.fn(() => () => {}),
})

beforeEach(() => _resetWikiOrchestratorForTests())

describe('wikiOrchestrator', () => {
  test('getOrSpawn returns same actor for repeat entityId', () => {
    const wiki = makeWikiMock() as never
    const a = wikiOrchestrator.getOrSpawn('e1', wiki)
    const b = wikiOrchestrator.getOrSpawn('e1', wiki)
    expect(a).toBe(b)
  })

  test('getOrSpawn returns distinct actors for distinct entityIds', () => {
    const wiki = makeWikiMock() as never
    const a = wikiOrchestrator.getOrSpawn('e1', wiki)
    const b = wikiOrchestrator.getOrSpawn('e2', wiki)
    expect(a).not.toBe(b)
  })

  test('stop removes the actor and unsubscribes status', () => {
    const unsubscribe = jest.fn()
    const wiki = {
      ...makeWikiMock(),
      subscribeEntityStatus: jest.fn(() => unsubscribe),
    } as never as ReturnType<typeof makeWikiMock>
    wikiOrchestrator.getOrSpawn('e1', wiki as never)
    wikiOrchestrator.stop('e1')
    expect(unsubscribe).toHaveBeenCalled()
    const fresh = wikiOrchestrator.getOrSpawn('e1', wiki as never)
    expect(wiki.subscribeEntityStatus).toHaveBeenCalledTimes(2)
    expect(fresh).toBeDefined()
  })

  test('syncAll runs at most `concurrency` syncs in flight', async () => {
    const wiki = makeWikiMock()
    let inFlight = 0
    let maxObserved = 0
    wiki.exportDump.mockImplementation(async () => {
      inFlight++
      maxObserved = Math.max(maxObserved, inFlight)
      await new Promise((r) => setTimeout(r, 10))
      inFlight--
      return { generatedAt: 0, entities: {} }
    })
    const ids = ['a', 'b', 'c', 'd', 'e']
    const runRemoteSync = jest.fn(async (d: unknown) => d)
    await wikiOrchestrator.syncAll(
      ids.map((id) => ({ entityId: id, runRemoteSync: runRemoteSync as never })),
      wiki as never,
      2,
    )
    expect(maxObserved).toBeLessThanOrEqual(2)
    expect(wiki.exportDump).toHaveBeenCalledTimes(5)
  })
})
