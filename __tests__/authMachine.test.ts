import { createActor, waitFor } from 'xstate'

const mockOnAuthStateChanged = jest.fn(() => jest.fn())
const mockFirebaseSignOut = jest.fn()

const mockBootstrapSession = jest.fn()

const mockSignOutFromGoogle = jest.fn()
const mockSignOutFromApple = jest.fn()

const mockLoginRevenueCat = jest.fn()
const mockLogoutRevenueCat = jest.fn()
const mockSetCrashlyticsUserId = jest.fn()
const mockQueryClientClear = jest.fn()

jest.mock('../src/config/firebaseConfig', () => ({
  onAuthStateChanged: mockOnAuthStateChanged,
  signOut: mockFirebaseSignOut,
}))

jest.mock('../src/auth/bootstrapSession', () => ({
  bootstrapSession: mockBootstrapSession,
}))

jest.mock('../src/auth/googleSignin', () => ({
  signInWithGoogle: jest.fn(),
  signOutFromGoogle: mockSignOutFromGoogle,
}))

jest.mock('../src/auth/appleSignin', () => ({
  signInWithApple: jest.fn(),
  signOutFromApple: mockSignOutFromApple,
}))

jest.mock('../src/config/revenueCatConfig', () => ({
  loginRevenueCat: mockLoginRevenueCat,
  logoutRevenueCat: mockLogoutRevenueCat,
}))

jest.mock('../src/services/crashlyticsService', () => ({
  setCrashlyticsUserId: mockSetCrashlyticsUserId,
}))

jest.mock('../src/config/queryClient', () => ({
  queryClient: {
    clear: mockQueryClientClear,
  },
}))

const { authMachine } = require('../src/machines/authMachine')

const WAIT_OPTS = { timeout: 2000 }

function makeUser(uid = 'firebase-user-1') {
  return {
    uid,
    displayName: 'Test User',
    email: 'test@example.com',
    photoURL: 'https://example.com/avatar.png',
    getIdToken: jest.fn().mockResolvedValue('firebase-token'),
  }
}

describe('authMachine', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFirebaseSignOut.mockResolvedValue(undefined)
    mockSignOutFromGoogle.mockResolvedValue(undefined)
    mockSignOutFromApple.mockResolvedValue(undefined)
    mockLogoutRevenueCat.mockResolvedValue(undefined)
    mockSetCrashlyticsUserId.mockResolvedValue(undefined)
  })

  it('reaches signedIn and stores bootstrap snapshot after USER_FOUND', async () => {
    const user = makeUser('firebase-123')
    const bootstrapData = {
      user: { id: 'user-1', firebaseUid: 'firebase-123', email: 'test@example.com' },
      subscription: { planTier: 'free', currentCredits: 50 }
    }
    mockBootstrapSession.mockResolvedValue(bootstrapData)

    const actor = createActor(authMachine)
    actor.start()
    actor.send({ type: 'USER_FOUND', user: user as any } as any)

    await waitFor(actor, (state) => state.matches('signedIn'), WAIT_OPTS)
    expect(actor.getSnapshot().context.dbUser).toEqual(bootstrapData.user)
    expect(actor.getSnapshot().context.subscription).toEqual(bootstrapData.subscription)
    expect(actor.getSnapshot().context.error).toBeNull()
    expect(mockLoginRevenueCat).toHaveBeenCalledWith('firebase-123')
    actor.stop()
  })

  it('returns to signedOut when bootstrap fails', async () => {
    const user = makeUser()
    const bootstrapError = new Error('bootstrap failed')
    mockBootstrapSession.mockRejectedValue(bootstrapError)

    const actor = createActor(authMachine)
    actor.start()
    actor.send({ type: 'USER_FOUND', user: user as any } as any)

    await waitFor(actor, (state) => state.matches('signedOut'), WAIT_OPTS)
    expect(actor.getSnapshot().context.error).toBe(bootstrapError)
    actor.stop()
  })

  it('clears stale error when NO_USER_FOUND is received in signedOut', async () => {
    const user = makeUser()
    const bootstrapError = new Error('bootstrap failed')
    mockBootstrapSession.mockRejectedValue(bootstrapError)

    const actor = createActor(authMachine)
    actor.start()
    actor.send({ type: 'USER_FOUND', user: user as any } as any)

    await waitFor(actor, (state) => state.matches('signedOut'), WAIT_OPTS)
    expect(actor.getSnapshot().context.error).toBe(bootstrapError)

    actor.send({ type: 'NO_USER_FOUND' })
    await waitFor(actor, (state) => state.matches('signedOut'), WAIT_OPTS)

    expect(actor.getSnapshot().context.error).toBeNull()
    actor.stop()
  })

  it('clears local session data when NO_USER_FOUND occurs after an active session', async () => {
    const user = makeUser()
    const bootstrapData = {
      user: { id: 'user-1' },
      subscription: { planTier: 'free' }
    }
    mockBootstrapSession.mockResolvedValue(bootstrapData)

    const actor = createActor(authMachine)
    actor.start()
    actor.send({ type: 'USER_FOUND', user: user as any } as any)
    await waitFor(actor, (state) => state.matches('signedIn'), WAIT_OPTS)

    actor.send({ type: 'NO_USER_FOUND' })
    await waitFor(actor, (state) => state.matches('signedOut'), WAIT_OPTS)

    expect(mockQueryClientClear).toHaveBeenCalled()
    expect(mockLogoutRevenueCat).toHaveBeenCalled()
    actor.stop()
  })

  it('still reaches signedOut and keeps error when SIGN_OUT fails', async () => {
    const user = makeUser()
    const bootstrapData = {
      user: { id: 'user-1' },
      subscription: { planTier: 'free' }
    }
    mockBootstrapSession.mockResolvedValue(bootstrapData)

    const actor = createActor(authMachine)
    actor.start()
    actor.send({ type: 'USER_FOUND', user: user as any } as any)
    await waitFor(actor, (state) => state.matches('signedIn'), WAIT_OPTS)

    const signOutError = new Error('sign-out failed')
    mockFirebaseSignOut.mockRejectedValue(signOutError)
    actor.send({ type: 'SIGN_OUT' })

    await waitFor(actor, (state) => state.matches('signedOut'), WAIT_OPTS)
    expect(mockFirebaseSignOut).toHaveBeenCalledTimes(1)
    expect(actor.getSnapshot().context.error).toBe(signOutError)
    actor.stop()
  })

  it('replays one pending refresh after bootstrapping when a new reason arrives mid-bootstrap', async () => {
    const user = makeUser('firebase-queue-1')
    const bootstrapData = {
      user: { id: 'user-queue-1' },
      subscription: { planTier: 'free', planStatus: 'active', currentCredits: 50 },
    }

    let resolveFirst!: (value: typeof bootstrapData) => void
    const firstPromise = new Promise<typeof bootstrapData>((resolve) => {
      resolveFirst = resolve
    })

    mockBootstrapSession
      .mockImplementationOnce(() => firstPromise)
      .mockResolvedValueOnce(bootstrapData)

    const actor = createActor(authMachine)
    actor.start()
    actor.send({ type: 'USER_FOUND', user: user as any } as any)

    await waitFor(actor, (state) => state.matches('bootstrapping'), WAIT_OPTS)
    actor.send({ type: 'REFRESH_BOOTSTRAP', reason: 'purchase' } as any)
    resolveFirst(bootstrapData)

    await waitFor(
      actor,
      () => mockBootstrapSession.mock.calls.length === 2 && actor.getSnapshot().matches('signedIn'),
      WAIT_OPTS,
    )

    expect(mockBootstrapSession).toHaveBeenCalledTimes(2)
    actor.stop()
  })

  it('clears pending refresh reason when it matches completed active refresh', async () => {
    const user = makeUser('firebase-replay-clear-1')
    const bootstrapData = {
      user: { id: 'user-replay-clear-1' },
      subscription: { planTier: 'free', planStatus: 'active', currentCredits: 50 },
    }

    let resolveManual!: (value: typeof bootstrapData) => void
    const manualPromise = new Promise<typeof bootstrapData>((resolve) => {
      resolveManual = resolve
    })

    mockBootstrapSession
      .mockResolvedValueOnce(bootstrapData)
      .mockImplementationOnce(() => manualPromise)
      .mockResolvedValueOnce(bootstrapData)

    const actor = createActor(authMachine)
    actor.start()
    actor.send({ type: 'USER_FOUND', user: user as any } as any)
    await waitFor(actor, (state) => state.matches('signedIn'), WAIT_OPTS)

    actor.send({ type: 'REFRESH_BOOTSTRAP', reason: 'manual' } as any)
    await waitFor(actor, (state) => state.matches('bootstrapping'), WAIT_OPTS)
    actor.send({ type: 'REFRESH_BOOTSTRAP', reason: 'manual' } as any)
    resolveManual(bootstrapData)

    await waitFor(actor, (state) => state.matches('signedIn'), WAIT_OPTS)
    expect(actor.getSnapshot().context.pendingRefreshReason).toBeNull()
    expect(actor.getSnapshot().context.lastRefreshReason).toBe('manual')
    expect(mockBootstrapSession).toHaveBeenCalledTimes(2)

    actor.send({ type: 'REFRESH_BOOTSTRAP', reason: 'purchase' } as any)
    await waitFor(
      actor,
      () => mockBootstrapSession.mock.calls.length === 3 && actor.getSnapshot().matches('signedIn'),
      WAIT_OPTS,
    )
    expect(mockBootstrapSession).toHaveBeenCalledTimes(3)
    actor.stop()
  })

  it('bypasses throttle for manual refresh reason', async () => {
    const user = makeUser('firebase-manual-1')
    const bootstrapData = {
      user: { id: 'user-manual-1' },
      subscription: { planTier: 'free', planStatus: 'active', currentCredits: 50 },
    }
    mockBootstrapSession.mockResolvedValue(bootstrapData)

    const actor = createActor(authMachine)
    actor.start()
    actor.send({ type: 'USER_FOUND', user: user as any } as any)
    await waitFor(actor, (state) => state.matches('signedIn'), WAIT_OPTS)

    actor.send({ type: 'REFRESH_BOOTSTRAP', reason: 'manual' } as any)
    await waitFor(actor, (state) => state.matches('signedIn'), WAIT_OPTS)

    actor.send({ type: 'REFRESH_BOOTSTRAP', reason: 'manual' } as any)
    await waitFor(actor, () => mockBootstrapSession.mock.calls.length >= 3, WAIT_OPTS)

    expect(mockBootstrapSession.mock.calls.length).toBeGreaterThanOrEqual(3)
    actor.stop()
  })
})
