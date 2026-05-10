import { createActor } from 'xstate'
import { WikiBusyError } from '@equationalapplications/expo-llm-wiki'
import { wikiMachine } from '~/machines/wikiMachine'

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
  test('READ → reading → idle and calls wiki.read', async () => {
    const wiki = makeWikiMock()
    const actor = spawn(wiki)
    actor.send({ type: 'READ', query: 'hello' })
    await new Promise((r) => setTimeout(r, 0))
    expect(wiki.read).toHaveBeenCalledWith('char1', 'hello')
    expect(actor.getSnapshot().value).toBe('idle')
  })

  test('WRITE → writing → idle and calls wiki.write', async () => {
    const wiki = makeWikiMock()
    const actor = spawn(wiki)
    actor.send({ type: 'WRITE', summary: 'note' })
    await new Promise((r) => setTimeout(r, 0))
    expect(wiki.write).toHaveBeenCalledWith('char1', {
      event_type: 'observation',
      summary: 'note',
    })
    expect(actor.getSnapshot().value).toBe('idle')
  })

  test('INGEST → ingesting → idle and calls wiki.ingestDocument', async () => {
    const wiki = makeWikiMock()
    const actor = spawn(wiki)
    const doc = { sourceRef: 's', sourceHash: 'h', documentChunk: 'c' }
    actor.send({ type: 'INGEST', doc })
    await new Promise((r) => setTimeout(r, 0))
    expect(wiki.ingestDocument).toHaveBeenCalledWith('char1', doc)
    expect(actor.getSnapshot().value).toBe('idle')
  })

  test('FORGET → forgetting → idle and calls wiki.forget', async () => {
    const wiki = makeWikiMock()
    const actor = spawn(wiki)
    actor.send({ type: 'FORGET', args: { sourceRef: 's' } })
    await new Promise((r) => setTimeout(r, 0))
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
    const actor = spawn(wiki)
    actor.send({ type: 'SYNC', cloudId: 'cloud-1', runRemoteSync: runRemoteSync as never })
    await new Promise((r) => setTimeout(r, 10))
    expect(order).toEqual(['export', 'remote', 'import', 'prune'])
    expect(actor.getSnapshot().value).toBe('idle')
  })

  test('mutation while in flight is queued (serialized)', async () => {
    const wiki = makeWikiMock()
    let resolveWrite: () => void = () => {}
    wiki.write.mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolveWrite = r
        }),
    )
    const actor = spawn(wiki)
    actor.send({ type: 'WRITE', summary: 'a' })
    actor.send({ type: 'WRITE', summary: 'b' })
    await new Promise((r) => setTimeout(r, 0))
    expect(wiki.write).toHaveBeenCalledTimes(1)
    resolveWrite()
    await new Promise((r) => setTimeout(r, 0))
    expect(wiki.write).toHaveBeenCalledTimes(2)
  })

  test('WikiBusyError → defers + retries on next event without reportError', async () => {
    const wiki = makeWikiMock()
    wiki.write.mockRejectedValueOnce(new WikiBusyError('librarian', 'char1'))
    wiki.write.mockResolvedValueOnce(undefined)
    const actor = spawn(wiki)
    actor.send({ type: 'WRITE', summary: 'x' })
    await new Promise((r) => setTimeout(r, 0))
    actor.send({ type: 'WRITE', summary: 'x' })
    await new Promise((r) => setTimeout(r, 0))
    expect(wiki.write).toHaveBeenCalledTimes(2)
    expect(actor.getSnapshot().context.lastError).toBeNull()
  })

  test('non-busy error → error state with assigned lastError', async () => {
    const wiki = makeWikiMock()
    const fault = new Error('disk full')
    wiki.write.mockRejectedValueOnce(fault)
    const actor = spawn(wiki)
    actor.send({ type: 'WRITE', summary: 'x' })
    await new Promise((r) => setTimeout(r, 0))
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
    const actor = spawn(wiki)
    cb!({ ingesting: true, librarian: false, heal: false })
    await new Promise((r) => setTimeout(r, 0))
    expect(actor.getSnapshot().context.status.ingesting).toBe(true)
  })

  test('actor stop unsubscribes from status', async () => {
    const unsubscribe = jest.fn()
    const wiki = makeWikiMock({
      subscribeEntityStatus: jest.fn(() => unsubscribe),
    })
    const actor = spawn(wiki)
    actor.stop()
    expect(unsubscribe).toHaveBeenCalled()
  })
})
