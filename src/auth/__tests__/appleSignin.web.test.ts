/** @jest-environment jsdom */

import { signInWithCredential, OAuthProvider, updateProfile } from 'firebase/auth'
import { generateNonce, sha256 } from '../nonce.web'
import { resetAppleSignInWebForTests, signInWithApple } from '../appleSignin.web'

jest.mock('firebase/auth', () => {
  const mockSignInWithCredential = jest.fn().mockResolvedValue({
    user: { displayName: null, providerData: [], updateProfile: jest.fn() },
  })
  const mockCredentialFn = jest.fn((opts: any) => ({ providerId: 'apple.com', ...opts }))
  class MockOAuthProvider {
    providerId: string
    constructor(id: string) {
      this.providerId = id
    }
    addScope(scope: string) {
      // no-op for compatibility with old implementation
    }
    credential(opts: any) {
      return mockCredentialFn(opts)
    }
  }
  return {
    OAuthProvider: MockOAuthProvider,
    getAuth: jest.fn(() => ({})),
    signInWithCredential: mockSignInWithCredential,
    updateProfile: jest.fn().mockResolvedValue(undefined),
  }
})
jest.mock('~/config/firebaseConfig.web', () => ({ firebaseApp: {} }))
jest.mock('../nonce.web', () => ({
  generateNonce: jest.fn(() => 'RAW_NONCE'),
  sha256: jest.fn(async () => 'HASHED_NONCE'),
}))

describe('appleSignin.web', () => {
  const originalClientId = process.env.EXPO_PUBLIC_APPLE_WEB_CLIENT_ID
  const originalRedirectUri = process.env.EXPO_PUBLIC_APPLE_WEB_REDIRECT_URI

  beforeEach(() => {
    jest.clearAllMocks()
    resetAppleSignInWebForTests()
    process.env.EXPO_PUBLIC_APPLE_WEB_CLIENT_ID = 'com.example.app.web'
    process.env.EXPO_PUBLIC_APPLE_WEB_REDIRECT_URI = 'https://example.com/auth/apple'
    ;(window as any).AppleID = {
      auth: {
        init: jest.fn(),
        signIn: jest.fn().mockResolvedValue({
          authorization: { id_token: 'APPLE_ID_TOKEN' },
          user: { name: { firstName: 'Jane', lastName: 'Doe' } },
        }),
      },
    }
  })

  afterEach(() => {
    if (originalClientId === undefined) {
      delete process.env.EXPO_PUBLIC_APPLE_WEB_CLIENT_ID
    } else {
      process.env.EXPO_PUBLIC_APPLE_WEB_CLIENT_ID = originalClientId
    }
    if (originalRedirectUri === undefined) {
      delete process.env.EXPO_PUBLIC_APPLE_WEB_REDIRECT_URI
    } else {
      process.env.EXPO_PUBLIC_APPLE_WEB_REDIRECT_URI = originalRedirectUri
    }
  })

  it('hashes the nonce, calls AppleID.auth.signIn, and exchanges via signInWithCredential', async () => {
    const result = await signInWithApple()
    expect(result.success).toBe(true)
    expect(generateNonce).toHaveBeenCalled()
    expect(sha256).toHaveBeenCalledWith('RAW_NONCE')
    expect((window as any).AppleID.auth.init).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: 'HASHED_NONCE', usePopup: true }),
    )
    const provider = new OAuthProvider('apple.com')
    expect((provider as any).credential).toBeDefined()
    expect(signInWithCredential).toHaveBeenCalled()
    const credentialArg = (signInWithCredential as jest.Mock).mock.calls[0][1]
    expect(credentialArg.idToken).toBe('APPLE_ID_TOKEN')
    expect(credentialArg.rawNonce).toBe('RAW_NONCE')
  })

  it('still succeeds when display name sync fails after credential exchange', async () => {
    jest.mocked(updateProfile).mockRejectedValueOnce(new Error('profile update failed'))
    const result = await signInWithApple()
    expect(result.success).toBe(true)
  })

  it('returns error when client id or redirect URI missing', async () => {
    process.env.EXPO_PUBLIC_APPLE_WEB_CLIENT_ID = ''
    const result = await signInWithApple()
    expect(result.success).toBe(false)
    expect(result.error).toContain('not configured')
  })

  it('returns error when Apple script unavailable', async () => {
    delete (window as any).AppleID
    const orig = document.createElement.bind(document)
    jest.spyOn(document, 'createElement').mockImplementation((tagName: any, options?: any) => {
      const el = orig(tagName, options)
      if (String(tagName).toLowerCase() === 'script') {
        queueMicrotask(() => (el as HTMLScriptElement).onerror?.(new Event('error')))
      }
      return el
    })
    try {
      const result = await signInWithApple()
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/unavailable|Failed to load/)
    } finally {
      jest.restoreAllMocks()
    }
  })

  it('returns error when script loads but AppleID.auth never appears', async () => {
    delete (window as any).AppleID
    const orig = document.createElement.bind(document)
    jest.spyOn(document, 'createElement').mockImplementation((tagName: any, options?: any) => {
      const el = orig(tagName, options)
      if (String(tagName).toLowerCase() === 'script') {
        queueMicrotask(() => (el as HTMLScriptElement).onload?.(new Event('load')))
      }
      return el
    })
    try {
      const result = await signInWithApple()
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/AppleID\.auth is unavailable/)
    } finally {
      jest.restoreAllMocks()
    }
  })

  it('returns error when no id_token in response', async () => {
    ;(window as any).AppleID.auth.signIn.mockResolvedValueOnce({
      authorization: {}
    })
    const result = await signInWithApple()
    expect(result.success).toBe(false)
    expect(result.error).toContain('No identity token')
  })

  it('returns error when credential exchange fails', async () => {
    ;(signInWithCredential as jest.Mock).mockRejectedValueOnce(
      new Error('Firebase auth error')
    )
    const result = await signInWithApple()
    expect(result.success).toBe(false)
  })

  it('handles popup cancellation gracefully', async () => {
    ;(window as any).AppleID.auth.signIn.mockRejectedValueOnce({
      error: 'popup_closed_by_user'
    })
    const result = await signInWithApple()
    expect(result.success).toBe(false)
    expect(result.error).toBe('Sign-in cancelled')
  })

  it('returns structured error when nonce hashing fails', async () => {
    ;(sha256 as jest.Mock).mockRejectedValueOnce(new Error('digest failed'))
    const result = await signInWithApple()
    expect(result.success).toBe(false)
    expect(result.error).toContain('digest failed')
  })
})
