/** @jest-environment node */

import { GoogleSignin } from '@react-native-google-signin/google-signin'
import { signInWithCredential } from '@react-native-firebase/auth'
import { syncDisplayNameFromCredential } from '~/auth/syncDisplayName'
import { signInWithGoogle } from '../googleSignin'

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn: jest.fn(),
    configure: jest.fn(),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: '12501',
    IN_PROGRESS: '10',
    PLAY_SERVICES_NOT_AVAILABLE: '7',
  },
}))

jest.mock('@react-native-firebase/auth', () => ({
  getAuth: jest.fn(() => ({})),
  signInWithCredential: jest.fn().mockResolvedValue({
    user: { displayName: null, providerData: [] },
  }),
  GoogleAuthProvider: {
    credential: jest.fn((idToken: string) => ({ idToken })),
  },
}))

jest.mock('~/auth/syncDisplayName', () => ({
  syncDisplayNameFromCredential: jest.fn().mockResolvedValue(undefined),
}))

describe('signInWithGoogle (native)', () => {
  const originalClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID

  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'error').mockImplementation(() => {})
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'test-web-client'
  })

  afterEach(() => {
    jest.restoreAllMocks()
    if (originalClientId === undefined) {
      delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
    } else {
      process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = originalClientId
    }
  })

  it('maps SIGN_IN_CANCELLED to { success: false, cancelled: true }', async () => {
    const err = Object.assign(new Error('cancelled'), { code: '12501' })
    ;(GoogleSignin.signIn as jest.Mock).mockRejectedValueOnce(err)
    const result = await signInWithGoogle()
    expect(result).toEqual({ success: false, cancelled: true, error: 'Sign-in was cancelled' })
  })

  it('maps IN_PROGRESS to { success: false } without cancelled flag', async () => {
    const err = Object.assign(new Error('in progress'), { code: '10' })
    ;(GoogleSignin.signIn as jest.Mock).mockRejectedValueOnce(err)
    const result = await signInWithGoogle()
    expect(result.success).toBe(false)
    expect((result as { cancelled?: boolean }).cancelled).toBeUndefined()
    expect(result.error).toMatch(/in progress/i)
  })

  it('maps PLAY_SERVICES_NOT_AVAILABLE to { success: false } without cancelled flag', async () => {
    const err = Object.assign(new Error('play services'), { code: '7' })
    ;(GoogleSignin.signIn as jest.Mock).mockRejectedValueOnce(err)
    const result = await signInWithGoogle()
    expect(result.success).toBe(false)
    expect((result as { cancelled?: boolean }).cancelled).toBeUndefined()
    expect(result.error).toMatch(/play services/i)
  })

  it('returns { success: true } on happy path, calls Firebase credential and syncs display name', async () => {
    ;(GoogleSignin.signIn as jest.Mock).mockResolvedValueOnce({
      data: {
        idToken: 'valid-id-token',
        user: { givenName: 'Jo', familyName: 'Test', name: 'Jo Test' },
      },
    })
    const result = await signInWithGoogle()
    expect(result.success).toBe(true)
    expect(signInWithCredential).toHaveBeenCalled()
    expect(syncDisplayNameFromCredential).toHaveBeenCalledWith(expect.anything(), 'Jo Test')
  })

  it('does not log the raw response payload', async () => {
    ;(GoogleSignin.signIn as jest.Mock).mockResolvedValueOnce({
      data: {
        idToken: 'super-secret-token',
        user: { givenName: 'Jo', familyName: 'Test', name: 'Jo Test' },
      },
    })
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    await signInWithGoogle()
    const allLogs = logSpy.mock.calls.map((args) => args.join(' '))
    expect(allLogs.every((msg) => !msg.includes('super-secret-token'))).toBe(true)
    logSpy.mockRestore()
  })
})
