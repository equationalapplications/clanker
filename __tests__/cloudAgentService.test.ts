const mockFetch = jest.fn()
global.fetch = mockFetch

// Helper to create module with specific mocks
function loadWithMocks({ hasCurrentUser = true, token = 'firebase-id-token' } = {}) {
  jest.resetModules()
  
  if (hasCurrentUser) {
    jest.doMock('~/config/firebaseConfig', () => ({
      auth: {
        currentUser: {
          getIdToken: jest.fn().mockResolvedValue(token),
        },
      },
    }))
  } else {
    jest.doMock('~/config/firebaseConfig', () => ({
      auth: { currentUser: null },
    }))
  }
  
  return require('~/services/cloudAgentService')
}

describe('callCloudAgent', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockReset()
    process.env = { ...OLD_ENV, EXPO_PUBLIC_CLOUD_AGENT_URL: 'http://10.0.0.1:8080' }
  })

  afterEach(() => {
    process.env = OLD_ENV
  })

  it('throws when EXPO_PUBLIC_CLOUD_AGENT_URL is not set', async () => {
    process.env.EXPO_PUBLIC_CLOUD_AGENT_URL = ''
    const { callCloudAgent } = loadWithMocks()
    await expect(
      callCloudAgent({ message: 'hi', characterId: 'char-1' }),
    ).rejects.toThrow('EXPO_PUBLIC_CLOUD_AGENT_URL is not configured')
  })

  it('throws when auth.currentUser is null', async () => {
    const { callCloudAgent } = loadWithMocks({ hasCurrentUser: false })
    await expect(
      callCloudAgent({ message: 'hi', characterId: 'char-1' }),
    ).rejects.toThrow('No authenticated user')
  })

  it('makes POST with Authorization header and returns reply', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ reply: 'Hello!', toolCalls: ['create_task'] }),
    })
    const { callCloudAgent } = loadWithMocks()

    const result = await callCloudAgent({
      message: 'hi',
      characterId: 'char-1',
      history: [{ role: 'user', parts: [{ text: 'hey' }] }],
      unsyncedHistory: [{ type: 'task', id: 't1', title: 'Buy milk', status: 'open', createdAt: 1000 }],
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'http://10.0.0.1:8080/agent/run',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer firebase-id-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          message: 'hi',
          characterId: 'char-1',
          history: [{ role: 'user', parts: [{ text: 'hey' }] }],
          unsyncedHistory: [{ type: 'task', id: 't1', title: 'Buy milk', status: 'open', createdAt: 1000 }],
        }),
      }),
    )
    expect(result).toEqual({ reply: 'Hello!', toolCalls: ['create_task'], usageSnapshot: null })
  })

  it('defaults toolCalls to [] when absent in response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ reply: 'Sure!' }),
    })
    const { callCloudAgent } = loadWithMocks()
    const result = await callCloudAgent({ message: 'hi', characterId: 'char-1' })
    expect(result.toolCalls).toEqual([])
  })

  it('throws when response is not ok', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 })
    const { callCloudAgent } = loadWithMocks()
    await expect(
      callCloudAgent({ message: 'hi', characterId: 'char-1' }),
    ).rejects.toThrow('Cloud Agent responded with 401')
  })

  it('throws CLOUD_AGENT_INSUFFICIENT_CREDITS when server returns 402', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 402 })
    const { callCloudAgent } = loadWithMocks()
    await expect(
      callCloudAgent({ message: 'hi', characterId: 'char-1' }),
    ).rejects.toThrow('CLOUD_AGENT_INSUFFICIENT_CREDITS')
  })

  it('does not throw generic HTTP error for 402 — only CLOUD_AGENT_INSUFFICIENT_CREDITS', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 402 })
    const { callCloudAgent } = loadWithMocks()
    await expect(
      callCloudAgent({ message: 'hi', characterId: 'char-1' }),
    ).rejects.not.toThrow('Cloud Agent responded with 402')
  })

  it('returns usageSnapshot with remainingCredits when present in response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ reply: 'Hi!', toolCalls: [], usageSnapshot: { remainingCredits: 42 } }),
    })
    const { callCloudAgent } = loadWithMocks()
    const result = await callCloudAgent({ message: 'hi', characterId: 'char-1' })
    expect(result.usageSnapshot).toEqual({ remainingCredits: 42 })
  })

  it('returns usageSnapshot: null when usageSnapshot is absent from response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ reply: 'Hi!', toolCalls: [] }),
    })
    const { callCloudAgent } = loadWithMocks()
    const result = await callCloudAgent({ message: 'hi', characterId: 'char-1' })
    expect(result.usageSnapshot).toBeNull()
  })

  it('returns usageSnapshot: null when remainingCredits is not a number', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ reply: 'Hi!', toolCalls: [], usageSnapshot: { remainingCredits: 'bad' } }),
    })
    const { callCloudAgent } = loadWithMocks()
    const result = await callCloudAgent({ message: 'hi', characterId: 'char-1' })
    expect(result.usageSnapshot).toBeNull()
  })

  it('returns usageSnapshot: null when usageSnapshot.remainingCredits is null', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ reply: 'Hi!', toolCalls: [], usageSnapshot: { remainingCredits: null } }),
    })
    const { callCloudAgent } = loadWithMocks()
    const result = await callCloudAgent({ message: 'hi', characterId: 'char-1' })
    expect(result.usageSnapshot).toBeNull()
  })

  it('throws when response body missing reply', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ toolCalls: [] }),
    })
    const { callCloudAgent } = loadWithMocks()
    await expect(
      callCloudAgent({ message: 'hi', characterId: 'char-1' }),
    ).rejects.toThrow('Invalid Cloud Agent response')
  })

  describe('backward-compatible URL normalization', () => {
    it.each([
      ['http://10.0.0.1:8080', 'http://10.0.0.1:8080/agent/run'],
      ['http://10.0.0.1:8080/', 'http://10.0.0.1:8080/agent/run'],
      ['http://10.0.0.1:8080/agent/run', 'http://10.0.0.1:8080/agent/run'],
      ['http://10.0.0.1:8080/agent/run/', 'http://10.0.0.1:8080/agent/run'],
    ])('strips trailing /agent/run from %s', async (inputUrl, expectedFetchUrl) => {
      process.env.EXPO_PUBLIC_CLOUD_AGENT_URL = inputUrl
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ reply: 'ok', toolCalls: [] }),
      })
      const { callCloudAgent } = loadWithMocks()
      await callCloudAgent({ message: 'hi', characterId: 'char-1' })
      expect(mockFetch).toHaveBeenCalledWith(
        expectedFetchUrl,
        expect.any(Object),
      )
    })
  })
})
