import { createActor, waitFor } from 'xstate'

const mockOnAuthStateChanged = jest.fn(() => jest.fn())
const mockFirebaseSignOut = jest.fn()

const mockSetSession = jest.fn()
const mockSupabaseSignOut = jest.fn()

const mockGetSupabaseUserSession = jest.fn()

const mockSignOutFromGoogle = jest.fn()
const mockSignOutFromApple = jest.fn()

const mockLoginRevenueCat = jest.fn()
const mockLogoutRevenueCat = jest.fn()
const mockSetCrashlyticsUserId = jest.fn()
const mockSyncFirebasePhotoToProfile = jest.fn()
const mockQueryClientClear = jest.fn()

jest.mock('../src/config/firebaseConfig', () => ({
  onAuthStateChanged: mockOnAuthStateChanged,
  signOut: mockFirebaseSignOut,
}))

jest.mock('../src/config/supabaseClient', () => ({
  supabaseClient: {
    auth: {
      setSession: mockSetSession,
      signOut: mockSupabaseSignOut,
    },
  },
}))

jest.mock('../src/auth/getSupabaseUserSession', () => ({
  getSupabaseUserSession: mockGetSupabaseUserSession,
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

jest.mock('../src/services/userService', () => ({
  syncFirebasePhotoToProfile: mockSyncFirebasePhotoToProfile,
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
    photoURL: 'https://example.com/avatar.png',
    getIdToken: jest.fn().mockResolvedValue('firebase-token'),
  }
}

describe('authMachine', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFirebaseSignOut.mockResolvedValue(undefined)
    mockSupabaseSignOut.mockResolvedValue({ error: null })
    mockSignOutFromGoogle.mockResolvedValue(undefined)
    mockSignOutFromApple.mockResolvedValue(undefined)
    mockLogoutRevenueCat.mockResolvedValue(undefined)
    mockSetCrashlyticsUserId.mockResolvedValue(undefined)
  })

  it('reaches signedIn and stores supabase session after USER_FOUND', async () => {
    const user = makeUser('firebase-123')
    const session = { expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'supa-1' } }
    mockGetSupabaseUserSession.mockResolvedValue({ access_token: 'a', refresh_token: 'r' })
    mockSetSession.mockResolvedValue({ data: { session }, error: null })

    const actor = createActor(authMachine)
    actor.start()
    actor.send({ type: 'USER_FOUND', user: user as any } as any)

    await waitFor(actor, (state) => state.matches('signedIn'), WAIT_OPTS)
    expect(actor.getSnapshot().context.supabaseSession).toEqual(session)
    expect(actor.getSnapshot().context.error).toBeNull()
    expect(mockLoginRevenueCat).toHaveBeenCalledWith('firebase-123')
    expect(mockSyncFirebasePhotoToProfile).toHaveBeenCalledWith('https://example.com/avatar.png')
    actor.stop()
  })

  it('returns to signedOut when token exchange fails', async () => {
    const user = makeUser()
    mockGetSupabaseUserSession.mockRejectedValue(new Error('exchange failed'))

    const actor = createActor(authMachine)
    actor.start()
    actor.send({ type: 'USER_FOUND', user: user as any } as any)

    await waitFor(actor, (state) => state.matches('signedOut'), WAIT_OPTS)
    expect(mockSetSession).not.toHaveBeenCalled()
    expect(actor.getSnapshot().context.error).toBeNull()
    actor.stop()
  })

  it('clears local session data when NO_USER_FOUND occurs after an active session', async () => {
    const user = makeUser()
    const session = { expires_at: Math.floor(Date.now() / 1000) + 3600 }
    mockGetSupabaseUserSession.mockResolvedValue({ access_token: 'a', refresh_token: 'r' })
    mockSetSession.mockResolvedValue({ data: { session }, error: null })

    const actor = createActor(authMachine)
    actor.start()
    actor.send({ type: 'USER_FOUND', user: user as any } as any)
    await waitFor(actor, (state) => state.matches('signedIn'), WAIT_OPTS)

    actor.send({ type: 'NO_USER_FOUND' })
    await waitFor(actor, (state) => state.matches('signedOut'), WAIT_OPTS)

    expect(mockQueryClientClear).toHaveBeenCalled()
    expect(mockSupabaseSignOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(mockLogoutRevenueCat).toHaveBeenCalled()
    actor.stop()
  })

  it('still reaches signedOut when SIGN_OUT fails', async () => {
    const user = makeUser()
    mockGetSupabaseUserSession.mockResolvedValue({ access_token: 'a', refresh_token: 'r' })
    mockSetSession.mockResolvedValue({
      data: { session: { expires_at: Math.floor(Date.now() / 1000) + 3600 } },
      error: null,
    })

    const actor = createActor(authMachine)
    actor.start()
    actor.send({ type: 'USER_FOUND', user: user as any } as any)
    await waitFor(actor, (state) => state.matches('signedIn'), WAIT_OPTS)

    mockFirebaseSignOut.mockRejectedValue(new Error('sign-out failed'))
    actor.send({ type: 'SIGN_OUT' })

    await waitFor(actor, (state) => state.matches('signedOut'), WAIT_OPTS)
    expect(mockFirebaseSignOut).toHaveBeenCalledTimes(1)
    expect(actor.getSnapshot().context.error).toBeNull()
    actor.stop()
  })
})