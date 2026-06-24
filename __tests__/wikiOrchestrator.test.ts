jest.mock('~/utilities/reportError', () => ({ reportError: jest.fn() }))

import { waitFor } from 'xstate'
import {
  wikiOrchestrator,
  _resetWikiOrchestratorForTests,
  type SyncAllItem,
} from '~/services/wikiOrchestrator'

const makeWikiMock = () => ({
  read: jest.fn().mockResolvedValue(null),
  write: jest.fn().mockResolvedValue(undefined),
  ingestDocument: jest.fn().mockResolvedValue(undefined),
  forget: jest.fn().mockResolvedValue(undefined),
  exportDump: jest.fn().mockResolvedValue({ generatedAt: 0, entities: {} }),
  importDump: jest.fn().mockResolvedValue(undefined),
  runPrune: jest.fn().mockResolvedValue(undefined),
  subscribeEntityStatus: jest.fn(() => () => {}),
  getOntologyManifest: jest.fn().mockResolvedValue(null),
  setOntologyManifest: jest.fn().mockResolvedValue(undefined),
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

  test('syncAll skips holes in a sparse items array without stopping workers early', async () => {
    const wiki = makeWikiMock()
    const runRemoteSync = jest.fn(async (d: unknown) => d)
    const items = [
      { entityId: 'a', runRemoteSync: runRemoteSync as never },
      ,
      { entityId: 'c', runRemoteSync: runRemoteSync as never },
    ] as unknown as SyncAllItem[]
    await wikiOrchestrator.syncAll(items, wiki as never, 2)
    expect(wiki.exportDump).toHaveBeenCalledTimes(2)
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

  test('stopActorsSpawnedForBatch runs when syncAll rejects (e.g. timeout)', async () => {
    const wiki = makeWikiMock()
    wiki.exportDump.mockImplementation(() => new Promise(() => {}))
    await expect(
      wikiOrchestrator.syncAll(
        [{ entityId: 'timeout-entity', runRemoteSync: async (d) => d as never }],
        wiki as never,
        1,
        80,
        { stopActorsSpawnedForBatch: true },
      ),
    ).rejects.toThrow(/timeout/)
    const sub = wiki.subscribeEntityStatus as jest.Mock
    sub.mockClear()
    wikiOrchestrator.getOrSpawn('timeout-entity', wiki as never)
    expect(sub).toHaveBeenCalledTimes(1)
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

  test('syncAll rejects fast when actor errors before SYNC runs (queued SYNC)', async () => {
    const wiki = makeWikiMock()
    const actor = wikiOrchestrator.getOrSpawn('e', wiki as never)
    wiki.write.mockImplementation(
      () =>
        new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error('write fail')), 25)
        }),
    )
    actor.send({ type: 'WRITE', summary: 'x' })
    await waitFor(actor, (s) => s.matches('writing'), { timeout: 2000 })

    await expect(
      wikiOrchestrator.syncAll(
        [{ entityId: 'e', runRemoteSync: async (d) => d as never }],
        wiki as never,
        1,
        8000,
      ),
    ).rejects.toThrow(/did not run: actor entered error before syncing/)
    expect(wiki.exportDump).not.toHaveBeenCalled()
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

  test('syncAll rejects when the sync invoke fails (e.g. exportDump)', async () => {
    const wiki = makeWikiMock()
    wiki.exportDump.mockRejectedValueOnce(new Error('export failed'))
    await expect(
      wikiOrchestrator.syncAll(
        [{ entityId: 'e', runRemoteSync: async (d) => d as never }],
        wiki as never,
        1,
        5000,
      ),
    ).rejects.toThrow('export failed')
  })

  describe('emergent ontology bootstrap', () => {
    it('seeds an empty emergent manifest when no ontology row exists yet', async () => {
      const wiki = makeWikiMock()
      wiki.getOntologyManifest.mockResolvedValue(null)
      wikiOrchestrator.getOrSpawn('e1', wiki as never)
      await new Promise((r) => setTimeout(r, 0))
      expect(wiki.getOntologyManifest).toHaveBeenCalledWith('e1')
      expect(wiki.setOntologyManifest).toHaveBeenCalledWith('e1', { node_types: [], edge_types: [] }, { mode: 'emergent' })
    })

    it('seeds when the existing mode is "off"', async () => {
      const wiki = makeWikiMock()
      wiki.getOntologyManifest.mockResolvedValue({ mode: 'off', manifest: { node_types: [], edge_types: [] } })
      wikiOrchestrator.getOrSpawn('e1', wiki as never)
      await new Promise((r) => setTimeout(r, 0))
      expect(wiki.setOntologyManifest).toHaveBeenCalledWith('e1', { node_types: [], edge_types: [] }, { mode: 'emergent' })
    })

    it('does not reseed when the existing mode is already emergent', async () => {
      const wiki = makeWikiMock()
      wiki.getOntologyManifest.mockResolvedValue({ mode: 'emergent', manifest: { node_types: [], edge_types: [] } })
      wikiOrchestrator.getOrSpawn('e1', wiki as never)
      await new Promise((r) => setTimeout(r, 0))
      expect(wiki.setOntologyManifest).not.toHaveBeenCalled()
    })

    it('does not reseed when the existing mode is strict', async () => {
      const wiki = makeWikiMock()
      wiki.getOntologyManifest.mockResolvedValue({ mode: 'strict', manifest: { node_types: [{ type: 'person', description: 'x' }], edge_types: [] } })
      wikiOrchestrator.getOrSpawn('e1', wiki as never)
      await new Promise((r) => setTimeout(r, 0))
      expect(wiki.setOntologyManifest).not.toHaveBeenCalled()
    })

    it('only checks once per entity per session: a second getOrSpawn for the same entity does not re-check', async () => {
      const wiki = makeWikiMock()
      wiki.getOntologyManifest.mockResolvedValue(null)
      wikiOrchestrator.getOrSpawn('e1', wiki as never)
      await new Promise((r) => setTimeout(r, 0))
      wiki.getOntologyManifest.mockClear()
      wikiOrchestrator.getOrSpawn('e1', wiki as never)
      await new Promise((r) => setTimeout(r, 0))
      expect(wiki.getOntologyManifest).not.toHaveBeenCalled()
    })

    it('does not throw or block actor creation when getOntologyManifest rejects', async () => {
      const wiki = makeWikiMock()
      wiki.getOntologyManifest.mockRejectedValue(new Error('SQLite locked'))
      const actor = wikiOrchestrator.getOrSpawn('e1', wiki as never)
      await new Promise((r) => setTimeout(r, 0))
      expect(actor).toBeDefined()
      expect(wiki.setOntologyManifest).not.toHaveBeenCalled()
    })
  })
})
