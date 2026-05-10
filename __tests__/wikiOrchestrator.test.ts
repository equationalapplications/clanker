jest.mock('~/utilities/reportError', () => ({ reportError: jest.fn() }))

import { waitFor } from 'xstate'
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

  test('syncAll resolves when a second item shares an actor already syncing', async () => {
    const wiki = makeWikiMock()
    let releaseExport: (() => void) | undefined
    const exportGate = new Promise<void>((resolve) => {
      releaseExport = resolve
    })
    wiki.exportDump.mockImplementation(async () => {
      await exportGate
      return { generatedAt: 0, entities: {} }
    })
    const runRemoteSync = jest.fn(async (d: unknown) => d)
    const done = wikiOrchestrator.syncAll(
      [
        { entityId: 'shared', runRemoteSync: runRemoteSync as never },
        { entityId: 'shared', runRemoteSync: runRemoteSync as never },
      ],
      wiki as never,
      2,
    )
    await new Promise((r) => setTimeout(r, 30))
    releaseExport!()
    await expect(done).resolves.toBeUndefined()
    expect(wiki.exportDump).toHaveBeenCalledTimes(1)
  })

  test('stopActorsSpawnedForBatch stops actors created only for the batch', async () => {
    const wiki = makeWikiMock()
    const subscribe = wiki.subscribeEntityStatus as jest.Mock
    await wikiOrchestrator.syncAll(
      [{ entityId: 'batch-only', runRemoteSync: async (d) => d as never }],
      wiki as never,
      2,
      60_000,
      { stopActorsSpawnedForBatch: true },
    )
    subscribe.mockClear()
    wikiOrchestrator.getOrSpawn('batch-only', wiki as never)
    expect(subscribe).toHaveBeenCalledTimes(1)
  })

  test('syncAll rejects when RETRY cannot drain queued work before SYNC', async () => {
    const wiki = makeWikiMock()
    const actor = wikiOrchestrator.getOrSpawn('e', wiki as never)
    wiki.write.mockRejectedValueOnce(new Error('bad'))
    actor.send({ type: 'WRITE', summary: 'bad' })
    await waitFor(actor, (s) => s.matches('error'), { timeout: 2000 })
    wiki.write.mockRejectedValueOnce(new Error('still bad'))
    actor.send({ type: 'WRITE', summary: 'queued' })

    await expect(
      wikiOrchestrator.syncAll(
        [{ entityId: 'e', runRemoteSync: async (d) => d as never }],
        wiki as never,
        1,
        800,
      ),
    ).rejects.toThrow(/idle after RETRY/)
  })

  test('syncAll runs SYNC after RETRY drains queued writes', async () => {
    const wiki = makeWikiMock()
    const actor = wikiOrchestrator.getOrSpawn('e', wiki as never)
    wiki.write.mockRejectedValueOnce(new Error('bad'))
    actor.send({ type: 'WRITE', summary: 'bad' })
    await waitFor(actor, (s) => s.matches('error'), { timeout: 2000 })
    wiki.write.mockResolvedValueOnce(undefined)
    actor.send({ type: 'WRITE', summary: 'ok' })

    await wikiOrchestrator.syncAll(
      [{ entityId: 'e', runRemoteSync: async (d) => d as never }],
      wiki as never,
    )
    expect(wiki.exportDump).toHaveBeenCalled()
  })

  test('stopActorsSpawnedForBatch does not stop actors that existed before syncAll', async () => {
    const wiki = makeWikiMock()
    wikiOrchestrator.getOrSpawn('kept', wiki as never)
    const subscribe = wiki.subscribeEntityStatus as jest.Mock
    await wikiOrchestrator.syncAll(
      [{ entityId: 'kept', runRemoteSync: async (d) => d as never }],
      wiki as never,
      2,
      60_000,
      { stopActorsSpawnedForBatch: true },
    )
    subscribe.mockClear()
    wikiOrchestrator.getOrSpawn('kept', wiki as never)
    expect(subscribe).not.toHaveBeenCalled()
  })
})
