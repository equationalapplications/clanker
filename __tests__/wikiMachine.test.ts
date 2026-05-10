import { createActor, waitFor } from 'xstate'
import { WikiBusyError } from '@equationalapplications/expo-llm-wiki'
import { wikiMachine } from '~/machines/wikiMachine'

const WAIT_OPTS = { timeout: 2000 }

const makeWikiMock = (overrides: Partial<Record<string, unknown>> = {}) => ({
  read: jest.fn().mockResolvedValue({ facts: [], tasks: [], events: [] }),
  write: jest.fn().mockResolvedValue(undefined),
  ingestDocument: jest.fn().mockResolvedValue(undefined),
  forget: jest.fn().mockResolvedValue(undefined),
  exportDump: jest.fn().mockResolvedValue({ generatedAt: 0, entities: {} }),
  importDump: jest.fn().mockResolvedValue(undefined),
  runPrune: jest.fn().mockResolvedValue(undefined),
  subscribeEntityStatus: jest.fn().mockImplementation((_id: string, cb: (s: unknown) => void) => {
    cb({ ingesting: false, librarian: false, heal: false })
    return () => {}
  }),
  ...overrides,
})

const spawn = (wiki: unknown) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createActor(wikiMachine, { input: { entityId: 'char1', wiki: wiki as any } }).start()

describe('wikiMachine', () => {
  const actors: Array<ReturnType<typeof spawn>> = []
  
  afterEach(() => {
    // Stop all actors to clean up intervals/subscriptions
    actors.forEach((actor) => actor.stop())
    actors.length = 0
  })
  
  const spawnAndTrack = (wiki: unknown) => {
    const actor = spawn(wiki)
    actors.push(actor)
    return actor
  }

  test('READ → reading → idle and calls wiki.read', async () => {
    const wiki = makeWikiMock()
    const actor = spawnAndTrack(wiki)
    actor.send({ type: 'READ', query: 'hello' })
    await waitFor(actor, (state) => state.matches('idle'), WAIT_OPTS)
    expect(wiki.read).toHaveBeenCalledWith('char1', 'hello')
    expect(actor.getSnapshot().value).toBe('idle')
  })

  test('WRITE → writing → idle and calls wiki.write', async () => {
    const wiki = makeWikiMock()
    const actor = spawnAndTrack(wiki)
    actor.send({ type: 'WRITE', summary: 'note' })
    await waitFor(actor, (state) => state.matches('idle'), WAIT_OPTS)
    expect(wiki.write).toHaveBeenCalledWith('char1', {
      event_type: 'observation',
      summary: 'note',
    })
    expect(actor.getSnapshot().value).toBe('idle')
  })

  test('INGEST → ingesting → idle and calls wiki.ingestDocument', async () => {
    const wiki = makeWikiMock()
    const actor = spawnAndTrack(wiki)
    const doc = { sourceRef: 's', sourceHash: 'h', documentChunk: 'c' }
    actor.send({ type: 'INGEST', doc })
    await waitFor(actor, (state) => state.matches('idle'), WAIT_OPTS)
    expect(wiki.ingestDocument).toHaveBeenCalledWith('char1', doc)
    expect(actor.getSnapshot().value).toBe('idle')
  })

  test('FORGET → forgetting → idle and calls wiki.forget', async () => {
    const wiki = makeWikiMock()
    const actor = spawnAndTrack(wiki)
    actor.send({ type: 'FORGET', args: { sourceRef: 's' } })
    await waitFor(actor, (state) => state.matches('idle'), WAIT_OPTS)
    expect(wiki.forget).toHaveBeenCalledWith('char1', { sourceRef: 's' })
    expect(actor.getSnapshot().value).toBe('idle')
  })

  test('SYNC runs export → runRemoteSync → import → prune in order', async () => {
    const wiki = makeWikiMock()
    const order: string[] = []
    wiki.exportDump.mockImplementation(async () => {
      order.push('export')
      return { generatedAt: 0, entities: {} }
    })
    wiki.importDump.mockImplementation(async () => {
      order.push('import')
    })
    wiki.runPrune.mockImplementation(async () => {
      order.push('prune')
    })
    const runRemoteSync = jest.fn(async (dump: unknown) => {
      order.push('remote')
      return dump
    })
    const actor = spawnAndTrack(wiki)
    actor.send({ type: 'SYNC', runRemoteSync: runRemoteSync as never })
    await waitFor(actor, (state) => state.matches('idle'), WAIT_OPTS)
    expect(order).toEqual(['export', 'remote', 'import', 'prune'])
    expect(actor.getSnapshot().value).toBe('idle')
  })

  test('mutation while in flight is queued (serialized)', async () => {
    const wiki = makeWikiMock()
    const resolvers: Array<() => void> = []
    wiki.write.mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolvers.push(r)
        }),
    )
    const actor = spawnAndTrack(wiki)
    actor.send({ type: 'WRITE', summary: 'a' })
    actor.send({ type: 'WRITE', summary: 'b' })
    await waitFor(actor, (state) => state.matches('writing'), WAIT_OPTS)
    expect(wiki.write).toHaveBeenCalledTimes(1)
    resolvers[0]() // Resolve first write
    // After first write completes, machine goes to idle, flushes pending, and starts second write
    await waitFor(actor, (state) => wiki.write.mock.calls.length === 2, WAIT_OPTS)
    expect(wiki.write).toHaveBeenCalledTimes(2)
    resolvers[1]() // Resolve second write
    await waitFor(actor, (state) => state.matches('idle'), WAIT_OPTS)
  })

  test('WikiBusyError → re-enqueues and retries automatically', async () => {
    const wiki = makeWikiMock()
    wiki.write.mockRejectedValueOnce(new WikiBusyError('librarian', 'char1'))
    wiki.write.mockResolvedValueOnce(undefined)
    const actor = spawnAndTrack(wiki)
    actor.send({ type: 'WRITE', summary: 'x' })
    // Wait for both attempts to complete
    await waitFor(actor, (state) => state.matches('idle'), WAIT_OPTS)
    // Should have been called twice: once failed with busy, once succeeded
    expect(wiki.write).toHaveBeenCalledTimes(2)
    expect(actor.getSnapshot().context.lastError).toBeNull()
  })

  test('non-busy error → error state with assigned lastError', async () => {
    const wiki = makeWikiMock()
    const fault = new Error('disk full')
    wiki.write.mockRejectedValueOnce(fault)
    const actor = spawnAndTrack(wiki)
    actor.send({ type: 'WRITE', summary: 'x' })
    await waitFor(actor, (state) => state.matches('error'), WAIT_OPTS)
    expect(actor.getSnapshot().value).toBe('error')
    expect(actor.getSnapshot().context.lastError).toBe(fault)
  })

  test('STATUS event updates context.status', async () => {
    let cb: ((s: unknown) => void) | undefined
    const wiki = makeWikiMock({
      subscribeEntityStatus: jest.fn((_id: string, fn: (s: unknown) => void) => {
        cb = fn
        return () => {}
      }),
    })
    const actor = spawnAndTrack(wiki)
    cb!({ ingesting: true, librarian: false, heal: false })
    await waitFor(actor, (state) => state.context.status.ingesting === true, WAIT_OPTS)
    expect(actor.getSnapshot().context.status.ingesting).toBe(true)
    actor.stop() // Clean up
  })

  test('actor stop unsubscribes from status', async () => {
    const unsubscribe = jest.fn()
    const wiki = makeWikiMock({
      subscribeEntityStatus: jest.fn(() => unsubscribe),
    })
    const actor = spawnAndTrack(wiki)
    actor.stop()
    expect(unsubscribe).toHaveBeenCalled()
  })
})
