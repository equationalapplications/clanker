/**
 * Scoped coverage for the agent_image ingestion funnel (spec §6.5): whatever
 * the transport, exactly one onAgentImage callback reaches the caller with the
 * same two-field payload.
 */
import { callCloudAgent } from '~/services/cloudAgentService'

jest.mock('~/config/firebaseConfig', () => ({
  getCurrentUser: () => ({ getIdToken: async () => 'fake-token' }),
}))

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  url: string
  sent: string[] = []
  private listeners: Record<string, ((ev: unknown) => void)[]> = {}

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, cb: (ev: unknown) => void): void {
    ;(this.listeners[type] ??= []).push(cb)
  }

  removeEventListener(): void {}

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {}

  emit(type: string, ev: unknown): void {
    for (const cb of this.listeners[type] ?? []) cb(ev)
  }
}

const originalWs = global.WebSocket
// getCloudAgentBaseUrl() requires this in dev/test builds (same setup as
// useEdgeAgent.test.ts); without it every transport call throws before the
// funnel under test is reached.
const originalBaseUrl = process.env.EXPO_PUBLIC_CLOUD_AGENT_URL

beforeEach(() => {
  process.env.EXPO_PUBLIC_CLOUD_AGENT_URL = 'http://localhost:8080'
  FakeWebSocket.instances = []
  ;(global as { WebSocket: unknown }).WebSocket = FakeWebSocket
})

afterEach(() => {
  process.env.EXPO_PUBLIC_CLOUD_AGENT_URL = originalBaseUrl
  ;(global as { WebSocket: unknown }).WebSocket = originalWs
  jest.restoreAllMocks()
})

function lastSocket(): FakeWebSocket {
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
  if (!socket) throw new Error('no websocket created')
  return socket
}

describe('WS agent_image frame', () => {
  it('funnels the frame through onAgentImage before resolution', async () => {
    const seen: unknown[] = []
    const order: string[] = []
    const pending = callCloudAgent(
      { message: 'draw', characterId: 'cloud-1' },
      {
        onAgentImage: (img) => {
          seen.push(img)
          order.push('image')
        },
      },
    )
    await Promise.resolve()
    const socket = lastSocket()
    socket.emit('open', {})
    socket.emit('message', {
      data: JSON.stringify({ type: 'token', text: 'sure, drawing…' }),
    })
    socket.emit('message', {
      data: JSON.stringify({ type: 'agent_image', imageBase64: 'QUJD', mimeType: 'image/png' }),
    })
    socket.emit('message', {
      data: JSON.stringify({ type: 'usage_snapshot', remainingCredits: 800 }),
    })
    socket.emit('close', { code: 1000 })

    const result = await pending
    expect(seen).toEqual([{ imageBase64: 'QUJD', mimeType: 'image/png' }])
    expect(order).toEqual(['image'])
    expect(result.reply).toBe('sure, drawing…')
    expect(result.usageSnapshot).toEqual({ remainingCredits: 800 })
    expect(socket.sent.length).toBeGreaterThan(0)
  })

  it('ignores malformed agent_image frames instead of crashing', async () => {
    const seen: unknown[] = []
    const pending = callCloudAgent(
      { message: 'draw', characterId: 'cloud-1' },
      { onAgentImage: (img) => seen.push(img) },
    )
    await Promise.resolve()
    const socket = lastSocket()
    socket.emit('open', {})
    socket.emit('message', { data: JSON.stringify({ type: 'agent_image' }) })
    socket.emit('message', {
      data: JSON.stringify({ type: 'usage_snapshot', remainingCredits: 1 }),
    })
    socket.emit('close', { code: 1000 })
    await pending
    expect(seen).toEqual([])
  })
})

describe('HTTP generatedImage field', () => {
  beforeEach(() => {
    // callCloudAgent prefers WS; closing with 4001 (auth timeout) reaches the
    // mocked-fetch HTTP fallback deterministically without tripping the 60s
    // transport cooldown. Silence the expected fallback warning.
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('funnels the response field through onAgentImage', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        reply: 'here you go',
        toolCalls: ['generate_image'],
        usageSnapshot: { remainingCredits: 600 },
        generatedImage: { imageBase64: 'SFRUUC', mimeType: 'image/jpeg' },
      }),
    }))
    global.fetch = fetchMock as unknown as typeof fetch

    const seen: unknown[] = []
    const pending = callCloudAgent(
      { message: 'draw', characterId: 'cloud-1' },
      { onAgentImage: (img) => seen.push(img) },
    )
    await Promise.resolve()
    lastSocket().emit('close', { code: 4001 })

    const result = await pending
    expect(seen).toEqual([{ imageBase64: 'SFRUUC', mimeType: 'image/jpeg' }])
    // The image rides only on the callback — CloudAgentResult deliberately has
    // no generatedImage field, hence the cast to assert its absence.
    expect((result as { generatedImage?: unknown }).generatedImage).toBeUndefined()
  })

  it('delivers nothing when the field is absent (old server)', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ reply: 'text only', toolCalls: [] }),
    }))
    global.fetch = fetchMock as unknown as typeof fetch
    const seen: unknown[] = []
    const pending = callCloudAgent(
      { message: 'hi', characterId: 'cloud-1' },
      { onAgentImage: (img) => seen.push(img) },
    )
    await Promise.resolve()
    lastSocket().emit('close', { code: 4001 })
    await pending
    expect(seen).toEqual([])
  })
})
