/** @jest-environment jsdom */

import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth'
import {
  initializeGoogleSignIn,
  renderGoogleSignInButton,
  resetGoogleSignInWebForTests,
} from '../googleSignin.web'
import { syncDisplayNameFromCredential } from '../syncDisplayName.web'

jest.mock('firebase/auth', () => {
  const signInWithCredential = jest.fn().mockResolvedValue({
    user: { displayName: null, providerData: [], updateProfile: jest.fn() },
  })
  const credential = jest.fn((idToken: string) => ({ idToken }))
  class GoogleAuthProvider {
    static credential = credential
  }
  return {
    GoogleAuthProvider,
    getAuth: jest.fn(() => ({})),
    signInWithCredential,
  }
})
jest.mock('~/config/firebaseConfig.web', () => ({ firebaseApp: {} }))
jest.mock('../syncDisplayName.web', () => ({
  syncDisplayNameFromCredential: jest.fn().mockResolvedValue(undefined),
}))

const originalClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID

const makeHandlers = () => ({
  onCredentialStart: jest.fn(),
  onCredentialSuccess: jest.fn(),
  onCredentialError: jest.fn(),
})

const triggerGisCallback = async (credential = 'fake-id-token') => {
  const cb = (window as any).__gisCallback
  if (!cb) throw new Error('GIS callback not registered')
  await cb({ credential })
}

describe('googleSignin.web — handler-based FedCM API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetGoogleSignInWebForTests()
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'test-client-id'
    ;(window as any).google = {
      accounts: {
        id: {
          initialize: jest.fn(({ callback }) => {
            ;(window as any).__gisCallback = callback
          }),
          renderButton: jest.fn(),
        },
      },
    }
  })

  afterEach(() => {
    if (originalClientId === undefined) {
      delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
    } else {
      process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = originalClientId
    }
  })

  describe('initializeGoogleSignIn', () => {
    it('calls google.accounts.id.initialize with FedCM options', async () => {
      const handlers = makeHandlers()
      await initializeGoogleSignIn(handlers)
      expect((window as any).google.accounts.id.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          client_id: 'test-client-id',
          use_fedcm_for_button: true,
          auto_select: false,
          itp_support: true,
        }),
      )
    })

    it('does not inject a second <script> on repeated calls', async () => {
      const addSpy = jest.spyOn(document.body, 'appendChild')
      const handlers = makeHandlers()
      await initializeGoogleSignIn(handlers)
      await initializeGoogleSignIn(handlers)
      const scriptCalls = addSpy.mock.calls.filter(
        (args) => (args[0] as HTMLElement).tagName === 'SCRIPT',
      )
      expect(scriptCalls.length).toBeLessThanOrEqual(1)
      addSpy.mockRestore()
    })

    it('rejects when EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is missing', async () => {
      delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
      await expect(initializeGoogleSignIn(makeHandlers())).rejects.toThrow(
        /EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID/,
      )
    })

    it('rejects when the GIS script fails to load', async () => {
      delete (window as any).google
      const orig = document.createElement.bind(document)
      jest.spyOn(document, 'createElement').mockImplementation((tag: any, opts?: any) => {
        const el = orig(tag, opts)
        if (String(tag).toLowerCase() === 'script') {
          queueMicrotask(() => (el as HTMLScriptElement).onerror?.(new Event('error')))
        }
        return el
      })
      await expect(initializeGoogleSignIn(makeHandlers())).rejects.toThrow(/Failed to load/)
      jest.restoreAllMocks()
    })

    it('rejects when script loads but google.accounts.id is absent', async () => {
      delete (window as any).google
      const orig = document.createElement.bind(document)
      jest.spyOn(document, 'createElement').mockImplementation((tag: any, opts?: any) => {
        const el = orig(tag, opts)
        if (String(tag).toLowerCase() === 'script') {
          queueMicrotask(() => (el as HTMLScriptElement).onload?.(new Event('load')))
        }
        return el
      })
      await expect(initializeGoogleSignIn(makeHandlers())).rejects.toThrow(
        /google\.accounts\.id is unavailable/,
      )
      jest.restoreAllMocks()
    })
  })

  describe('renderGoogleSignInButton', () => {
    it('calls google.accounts.id.renderButton with container and default options', async () => {
      const handlers = makeHandlers()
      await initializeGoogleSignIn(handlers)
      const container = document.createElement('div')
      renderGoogleSignInButton(container)
      expect((window as any).google.accounts.id.renderButton).toHaveBeenCalledWith(
        container,
        expect.objectContaining({
          type: 'standard',
          theme: 'filled_blue',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'left',
        }),
      )
    })
  })

  describe('handleCredential (GIS callback)', () => {
    it('calls onCredentialStart then onCredentialSuccess on happy path', async () => {
      const handlers = makeHandlers()
      await initializeGoogleSignIn(handlers)
      await triggerGisCallback('my-id-token')
      expect(handlers.onCredentialStart).toHaveBeenCalled()
      expect(handlers.onCredentialSuccess).toHaveBeenCalled()
      expect(handlers.onCredentialError).not.toHaveBeenCalled()
      expect(handlers.onCredentialStart.mock.invocationCallOrder[0]).toBeLessThan(
        handlers.onCredentialSuccess.mock.invocationCallOrder[0],
      )
    })

    it('passes the id token to GoogleAuthProvider.credential and signInWithCredential', async () => {
      const handlers = makeHandlers()
      await initializeGoogleSignIn(handlers)
      await triggerGisCallback('real-token')
      expect(GoogleAuthProvider.credential).toHaveBeenCalledWith('real-token', null)
      expect(signInWithCredential).toHaveBeenCalled()
    })

    it('still calls onCredentialSuccess when syncDisplayNameFromCredential rejects', async () => {
      jest.mocked(syncDisplayNameFromCredential).mockRejectedValueOnce(new Error('sync fail'))
      const handlers = makeHandlers()
      await initializeGoogleSignIn(handlers)
      await triggerGisCallback()
      expect(handlers.onCredentialSuccess).toHaveBeenCalled()
      expect(handlers.onCredentialError).not.toHaveBeenCalled()
    })

    it('calls onCredentialError (not onCredentialSuccess) when signInWithCredential rejects', async () => {
      ;(signInWithCredential as jest.Mock).mockRejectedValueOnce(new Error('firebase auth error'))
      const handlers = makeHandlers()
      await initializeGoogleSignIn(handlers)
      await triggerGisCallback()
      expect(handlers.onCredentialError).toHaveBeenCalledWith(expect.any(Error))
      expect(handlers.onCredentialSuccess).not.toHaveBeenCalled()
      expect(syncDisplayNameFromCredential).not.toHaveBeenCalled()
    })

    it('calls onCredentialError when the response has no credential field', async () => {
      const handlers = makeHandlers()
      await initializeGoogleSignIn(handlers)
      const cb = (window as any).__gisCallback
      await cb({})
      expect(handlers.onCredentialError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringMatching(/No credential/) }),
      )
      expect(handlers.onCredentialStart).not.toHaveBeenCalled()
    })
  })
})
