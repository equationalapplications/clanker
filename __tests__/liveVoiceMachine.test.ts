jest.mock('~/database/characterDatabase', () => ({
  getCharacter: jest.fn(),
}))
jest.mock('~/services/wikiService', () => ({
  getWiki: jest.fn(),
}))
jest.mock('~/services/apiClient', () => ({
  wikiSync: jest.fn(),
}))
jest.mock('~/database/messageDatabase', () => ({
  saveAIMessage: jest.fn(),
  sendMessage: jest.fn(),
}))
jest.mock('~/config/firebaseConfig', () => ({
  getCurrentUser: jest.fn(),
}))

class MockWebSocket {
  static OPEN = 1
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  send = jest.fn()
  close = jest.fn()
  constructor(_url: string) {}
}

beforeAll(() => {
  process.env.EXPO_PUBLIC_CLOUD_AGENT_URL = 'https://example.com/agent/run'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  global.WebSocket = MockWebSocket as any
})

import { createActor, waitFor } from 'xstate'
import { liveVoiceMachine } from '~/machines/liveVoiceMachine'
import { getCharacter } from '~/database/characterDatabase'
import { getWiki } from '~/services/wikiService'
import { wikiSync } from '~/services/apiClient'
import { getCurrentUser } from '~/config/firebaseConfig'

const WAIT = { timeout: 3000 }
const CLOUD_CHAR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function makeCharacterMock(cloudId = CLOUD_CHAR_ID) {
  return { cloud_id: cloudId }
}

function makeWikiMock() {
  return {
    exportDump: jest.fn().mockResolvedValue({
      generatedAt: 0,
      entities: {
        char1: { facts: [], tasks: [], events: [], edges: [] },
      },
    }),
    importDump: jest.fn().mockResolvedValue(undefined),
  }
}

function makeUserMock(token = 'test-token') {
  return { getIdToken: jest.fn().mockResolvedValue(token) }
}

function spawnMachine(overrides: Record<string, unknown> = {}) {
  return createActor(liveVoiceMachine, {
    input: { characterId: 'char1', userId: 'user1', initialCredits: 10, ...overrides },
  }).start()
}

describe('liveVoiceMachine', () => {
  let actors: ReturnType<typeof spawnMachine>[] = []

  beforeEach(() => {
    jest.mocked(getCurrentUser).mockReturnValue(makeUserMock() as never)
    jest.mocked(getCharacter).mockResolvedValue(makeCharacterMock() as never)
  })

  afterEach(() => {
    actors.forEach((a) => a.stop())
    actors.length = 0
    jest.clearAllMocks()
  })

  function spawn(overrides: Record<string, unknown> = {}) {
    const actor = spawnMachine(overrides)
    actors.push(actor)
    return actor
  }

  function advanceToLive(actor: ReturnType<typeof spawn>, credits = 10) {
    actor.send({ type: 'START_CALL' })
    return waitFor(actor, (s) => s.matches({ session: 'connecting' }), WAIT).then(() => {
      actor.send({ type: 'SESSION_READY', remainingCredits: credits })
      return waitFor(actor, (s) => s.matches({ session: 'live' }), WAIT)
    })
  }

  test('starts in idle', () => {
    const actor = spawn()
    expect(actor.getSnapshot().matches('idle')).toBe(true)
  })

  test('START_CALL → syncing_memory and calls wiki.exportDump + wikiSync', async () => {
    const wiki = makeWikiMock()
    jest.mocked(getWiki).mockReturnValue(wiki as never)
    jest.mocked(wikiSync).mockResolvedValue({
      data: {
        remoteDump: {
          generatedAt: 0,
          entities: {
            [CLOUD_CHAR_ID]: { facts: [], tasks: [], events: [], edges: [] },
          },
        },
      },
    } as never)
    jest.mocked(getCurrentUser).mockReturnValue(makeUserMock() as never)

    const actor = spawn()
    actor.send({ type: 'START_CALL' })

    await waitFor(actor, (s) => s.matches({ session: 'connecting' }), WAIT)

    expect(wiki.exportDump).toHaveBeenCalledWith(['char1'])
    expect(wikiSync).toHaveBeenCalled()
  })

  test('failed wikiSync → error state', async () => {
    const wiki = makeWikiMock()
    jest.mocked(getWiki).mockReturnValue(wiki as never)
    jest.mocked(wikiSync).mockRejectedValue(new Error('sync failed'))

    const actor = spawn()
    actor.send({ type: 'START_CALL' })

    await waitFor(actor, (s) => s.matches('error'), WAIT)
    expect(actor.getSnapshot().context.socketError).toBe('sync failed')
  })

  test('TRANSCRIPT_TOKEN same role concatenates text', async () => {
    const wiki = makeWikiMock()
    jest.mocked(getWiki).mockReturnValue(wiki as never)
    jest.mocked(wikiSync).mockResolvedValue({
      data: {
        remoteDump: {
          generatedAt: 0,
          entities: {
            [CLOUD_CHAR_ID]: { facts: [], tasks: [], events: [], edges: [] },
          },
        },
      },
    } as never)
    jest.mocked(getCurrentUser).mockReturnValue(makeUserMock() as never)

    const actor = spawn()
    await advanceToLive(actor)

    actor.send({ type: 'TRANSCRIPT_TOKEN', role: 'model', text: 'Hello' })
    actor.send({ type: 'TRANSCRIPT_TOKEN', role: 'model', text: ' world' })

    const { transcript } = actor.getSnapshot().context
    expect(transcript).toHaveLength(1)
    expect(transcript[0].text).toBe('Hello world')
  })

  test('TRANSCRIPT_TOKEN role switch creates new message', async () => {
    const wiki = makeWikiMock()
    jest.mocked(getWiki).mockReturnValue(wiki as never)
    jest.mocked(wikiSync).mockResolvedValue({
      data: {
        remoteDump: {
          generatedAt: 0,
          entities: {
            [CLOUD_CHAR_ID]: { facts: [], tasks: [], events: [], edges: [] },
          },
        },
      },
    } as never)
    jest.mocked(getCurrentUser).mockReturnValue(makeUserMock() as never)

    const actor = spawn()
    await advanceToLive(actor)

    actor.send({ type: 'TRANSCRIPT_TOKEN', role: 'user', text: 'Hi' })
    actor.send({ type: 'TRANSCRIPT_TOKEN', role: 'model', text: 'Hello' })

    const { transcript } = actor.getSnapshot().context
    expect(transcript).toHaveLength(2)
    expect(transcript[0].user._id).toBe('user1')
    expect(transcript[1].user._id).toBe('char1')
  })

  test('TOOL_START sets activeTool, TOOL_END clears it', async () => {
    const wiki = makeWikiMock()
    jest.mocked(getWiki).mockReturnValue(wiki as never)
    jest.mocked(wikiSync).mockResolvedValue({
      data: {
        remoteDump: {
          generatedAt: 0,
          entities: {
            [CLOUD_CHAR_ID]: { facts: [], tasks: [], events: [], edges: [] },
          },
        },
      },
    } as never)
    jest.mocked(getCurrentUser).mockReturnValue(makeUserMock() as never)

    const actor = spawn()
    await advanceToLive(actor)

    actor.send({ type: 'TOOL_START', name: 'wiki_read' })
    expect(actor.getSnapshot().context.activeTool).toBe('wiki_read')

    actor.send({ type: 'TOOL_END', name: 'wiki_read' })
    expect(actor.getSnapshot().context.activeTool).toBeNull()
  })

  test('USAGE_SNAPSHOT updates remainingCredits', async () => {
    const wiki = makeWikiMock()
    jest.mocked(getWiki).mockReturnValue(wiki as never)
    jest.mocked(wikiSync).mockResolvedValue({
      data: {
        remoteDump: {
          generatedAt: 0,
          entities: {
            [CLOUD_CHAR_ID]: { facts: [], tasks: [], events: [], edges: [] },
          },
        },
      },
    } as never)
    jest.mocked(getCurrentUser).mockReturnValue(makeUserMock() as never)

    const actor = spawn({ initialCredits: 10 })
    await advanceToLive(actor)

    actor.send({ type: 'USAGE_SNAPSHOT', remainingCredits: 7 })
    expect(actor.getSnapshot().context.remainingCredits).toBe(7)
  })

  test('USAGE_SNAPSHOT with 0 credits → saving_to_db', async () => {
    const wiki = makeWikiMock()
    jest.mocked(getWiki).mockReturnValue(wiki as never)
    jest.mocked(wikiSync).mockResolvedValue({
      data: {
        remoteDump: {
          generatedAt: 0,
          entities: {
            [CLOUD_CHAR_ID]: { facts: [], tasks: [], events: [], edges: [] },
          },
        },
      },
    } as never)
    jest.mocked(getCurrentUser).mockReturnValue(makeUserMock() as never)

    const { saveAIMessage } = jest.requireMock('~/database/messageDatabase') as { saveAIMessage: jest.Mock }
    saveAIMessage.mockResolvedValue(undefined)

    const actor = spawn({ initialCredits: 1 })
    await advanceToLive(actor)

    const visitedStates: string[] = []
    const sub = actor.subscribe((s) => {
      visitedStates.push(String(s.value))
    })

    actor.send({ type: 'USAGE_SNAPSHOT', remainingCredits: 0 })

    await waitFor(actor, (s) => s.matches('idle'), WAIT)
    sub.unsubscribe()
    expect(visitedStates).toContain('saving_to_db')
    expect(actor.getSnapshot().context.remainingCredits).toBe(0)
  })

  test('GROUNDING_METADATA attaches to the last model transcript message', async () => {
    const wiki = makeWikiMock()
    jest.mocked(getWiki).mockReturnValue(wiki as never)
    jest.mocked(wikiSync).mockResolvedValue({
      data: {
        remoteDump: {
          generatedAt: 0,
          entities: {
            [CLOUD_CHAR_ID]: { facts: [], tasks: [], events: [], edges: [] },
          },
        },
      },
    } as never)
    jest.mocked(getCurrentUser).mockReturnValue(makeUserMock() as never)

    const googleHtml = '<style>.gs-chip{color:#1a73e8}</style><div>Suggestions</div>'
    const actor = spawn()
    await advanceToLive(actor)

    actor.send({ type: 'TRANSCRIPT_TOKEN', role: 'model', text: 'It is sunny today.' })
    actor.send({
      type: 'GROUNDING_METADATA',
      groundingMetadata: {
        searchEntryPoint: { renderedContent: googleHtml },
        groundingChunks: [{ web: { uri: 'https://example.com', title: 'Example' } }],
      },
    })

    const { transcript } = actor.getSnapshot().context
    expect(transcript).toHaveLength(1)
    expect(transcript[0].text).toBe('It is sunny today.')
    expect(
      (transcript[0] as { groundingMetadata?: { searchEntryPoint?: { renderedContent?: string } } })
        .groundingMetadata?.searchEntryPoint?.renderedContent,
    ).toBe(googleHtml)
  })

  test('END_CALL persists groundingMetadata on saved AI messages', async () => {
    const wiki = makeWikiMock()
    jest.mocked(getWiki).mockReturnValue(wiki as never)
    jest.mocked(wikiSync).mockResolvedValue({
      data: {
        remoteDump: {
          generatedAt: 0,
          entities: {
            [CLOUD_CHAR_ID]: { facts: [], tasks: [], events: [], edges: [] },
          },
        },
      },
    } as never)
    jest.mocked(getCurrentUser).mockReturnValue(makeUserMock() as never)

    const { saveAIMessage } = jest.requireMock('~/database/messageDatabase') as { saveAIMessage: jest.Mock }
    saveAIMessage.mockResolvedValue(undefined)

    const googleHtml = '<div>Suggestions</div>'
    const groundingMetadata = {
      searchEntryPoint: { renderedContent: googleHtml },
      groundingChunks: [{ web: { uri: 'https://example.com', title: 'Example' } }],
    }

    const actor = spawn()
    await advanceToLive(actor)

    actor.send({ type: 'TRANSCRIPT_TOKEN', role: 'model', text: 'Here is what I found.' })
    actor.send({ type: 'GROUNDING_METADATA', groundingMetadata })
    actor.send({ type: 'END_CALL' })

    await waitFor(actor, (s) => s.matches('idle'), WAIT)
    await new Promise((r) => setTimeout(r, 50))

    expect(saveAIMessage).toHaveBeenCalledWith(
      'char1',
      'user1',
      'Here is what I found.',
      expect.any(String),
      expect.objectContaining({
        groundingMetadata,
      }),
      expect.any(Number),
    )
  })

  test('END_CALL → saving_to_db → idle, calls saveAIMessage for model turns', async () => {
    const wiki = makeWikiMock()
    jest.mocked(getWiki).mockReturnValue(wiki as never)
    jest.mocked(wikiSync).mockResolvedValue({
      data: {
        remoteDump: {
          generatedAt: 0,
          entities: {
            [CLOUD_CHAR_ID]: { facts: [], tasks: [], events: [], edges: [] },
          },
        },
      },
    } as never)
    jest.mocked(getCurrentUser).mockReturnValue(makeUserMock() as never)

    const { saveAIMessage } = jest.requireMock('~/database/messageDatabase') as { saveAIMessage: jest.Mock }
    saveAIMessage.mockResolvedValue(undefined)

    const actor = spawn()
    await advanceToLive(actor)

    actor.send({ type: 'TRANSCRIPT_TOKEN', role: 'model', text: 'Hello!' })
    actor.send({ type: 'END_CALL' })

    await waitFor(actor, (s) => s.matches('idle'), WAIT)
    await new Promise((r) => setTimeout(r, 50))
    expect(saveAIMessage).toHaveBeenCalledWith(
      'char1',
      'user1',
      'Hello!',
      expect.any(String),
      expect.objectContaining({ user: expect.objectContaining({ _id: 'char1' }) }),
      expect.any(Number),
    )
    expect(actor.getSnapshot().context.transcript).toHaveLength(0)
  })

  test('END_CALL clears groundingMetadata so citations do not leak into the next session', async () => {
    const wiki = makeWikiMock()
    jest.mocked(getWiki).mockReturnValue(wiki as never)
    jest.mocked(wikiSync).mockResolvedValue({
      data: {
        remoteDump: {
          generatedAt: 0,
          entities: {
            [CLOUD_CHAR_ID]: { facts: [], tasks: [], events: [], edges: [] },
          },
        },
      },
    } as never)
    jest.mocked(getCurrentUser).mockReturnValue(makeUserMock() as never)

    const { saveAIMessage } = jest.requireMock('~/database/messageDatabase') as { saveAIMessage: jest.Mock }
    saveAIMessage.mockResolvedValue(undefined)

    const googleHtml = '<style>.gs-chip{color:#1a73e8}</style><div>Suggestions</div>'
    const actor = spawn()
    await advanceToLive(actor)

    actor.send({
      type: 'GROUNDING_METADATA',
      groundingMetadata: { searchEntryPoint: { renderedContent: googleHtml } },
    })
    expect(actor.getSnapshot().context.groundingMetadata?.searchEntryPoint?.renderedContent).toBe(googleHtml)

    actor.send({ type: 'END_CALL' })
    await waitFor(actor, (s) => s.matches('idle'), WAIT)

    expect(actor.getSnapshot().context.groundingMetadata).toBeNull()
  })

  test('SOCKET_ERROR → error state with message', async () => {
    const wiki = makeWikiMock()
    jest.mocked(getWiki).mockReturnValue(wiki as never)
    jest.mocked(wikiSync).mockResolvedValue({
      data: {
        remoteDump: {
          generatedAt: 0,
          entities: {
            [CLOUD_CHAR_ID]: { facts: [], tasks: [], events: [], edges: [] },
          },
        },
      },
    } as never)
    jest.mocked(getCurrentUser).mockReturnValue(makeUserMock() as never)

    const actor = spawn()
    await advanceToLive(actor)

    actor.send({ type: 'SOCKET_ERROR', message: 'Network unreachable' })

    await waitFor(actor, (s) => s.matches('error'), WAIT)
    expect(actor.getSnapshot().context.socketError).toBe('Network unreachable')
  })

  test('RETRY from error → syncing_memory → session.connecting, increments retryCount', async () => {
    const wiki = makeWikiMock()
    jest.mocked(getWiki).mockReturnValue(wiki as never)
    jest.mocked(wikiSync).mockResolvedValue({
      data: {
        remoteDump: {
          generatedAt: 0,
          entities: {
            [CLOUD_CHAR_ID]: { facts: [], tasks: [], events: [], edges: [] },
          },
        },
      },
    } as never)
    jest.mocked(getCurrentUser).mockReturnValue(makeUserMock() as never)

    const actor = spawn()
    await advanceToLive(actor)

    actor.send({ type: 'SOCKET_ERROR', message: 'Dropped' })
    await waitFor(actor, (s) => s.matches('error'), WAIT)

    actor.send({ type: 'RETRY' })
    await waitFor(actor, (s) => s.matches({ session: 'connecting' }), WAIT)
    expect(actor.getSnapshot().context.retryCount).toBe(1)
  })
})
