import React from 'react'
import { act, create } from 'react-test-renderer'
import { Appearance } from 'react-native'
import { CookieConsentProvider } from '~/components/CookieConsent'
import {
  SettingsProvider,
  clearSettings,
  useSettings,
} from '~/contexts/SettingsContext'
import * as crashlyticsService from '~/services/crashlyticsService'
import { Storage } from '~/utilities/kvStorage'
import { CONSENT_STORAGE_KEY } from '~/utilities/cookieConsentTypes'

const mockStorageSetItemSync = jest.fn()
const mockStorageRemoveItem = jest.fn().mockResolvedValue(undefined)

jest.mock('~/utilities/kvStorage', () => ({
  Storage: {
    getItemSync: jest.fn().mockReturnValue(null),
    setItemSync: (...args: unknown[]) => mockStorageSetItemSync(...args),
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: (...args: unknown[]) => mockStorageRemoveItem(...args),
  },
}))

jest.mock('~/services/crashlyticsService', () => ({
  initializeCrashlytics: jest.fn().mockResolvedValue(undefined),
  setCrashlyticsEnabled: jest.fn().mockResolvedValue(undefined),
  setCrashlyticsUserId: jest.fn().mockResolvedValue(undefined),
  logCrashlyticsError: jest.fn().mockResolvedValue(undefined),
}))

function Probe({ onReady }: { onReady: (api: ReturnType<typeof useSettings>) => void }) {
  const api = useSettings()
  React.useEffect(() => onReady(api), [api, onReady])
  return null
}

function withConsent(preferences: boolean) {
  window.localStorage.setItem(
    CONSENT_STORAGE_KEY,
    JSON.stringify({
      policyVersion: 1,
      consentedAt: '2026-01-01T00:00:00Z',
      expiresAt: '2099-01-01T00:00:00Z',
      regionMode: 'opt-in-strict',
      choices: {
        necessary: true,
        analytics: true,
        marketing: false,
        preferences,
      },
    }),
  )
}

describe('SettingsContext', () => {
  beforeEach(() => {
    window.localStorage.clear()
    jest.clearAllMocks()
  })

  describe('clearSettings', () => {
    it('writes empty string for each setting key', () => {
      clearSettings()
      expect(mockStorageSetItemSync).toHaveBeenCalledWith('setting:analytics', '')
      expect(mockStorageSetItemSync).toHaveBeenCalledWith('setting:darkMode', '')
      expect(mockStorageSetItemSync).toHaveBeenCalledWith('setting:notifications', '')
    })

    it('calls removeItem for each setting key', () => {
      clearSettings()
      expect(mockStorageRemoveItem).toHaveBeenCalledWith('setting:analytics')
      expect(mockStorageRemoveItem).toHaveBeenCalledWith('setting:darkMode')
      expect(mockStorageRemoveItem).toHaveBeenCalledWith('setting:notifications')
    })
  })

  describe('updateSetting darkMode — preferences consent gate (web only)', () => {
    beforeEach(() => {
      // The darkMode consent gate only applies on web
      ;(globalThis as any).__setJestPlatformOS('web')
    })
    afterEach(() => {
      ;(globalThis as any).__resetJestPlatformOS()
    })

    it('does NOT persist darkMode when preferences consent is not granted', () => {
      withConsent(false)
      let api: any
      act(() => {
        create(
          <CookieConsentProvider>
            <SettingsProvider>
              <Probe onReady={(a) => { api = a }} />
            </SettingsProvider>
          </CookieConsentProvider>,
        )
      })
      mockStorageSetItemSync.mockClear()

      act(() => api.updateSetting('darkMode', true))

      const calls = mockStorageSetItemSync.mock.calls.filter(
        ([key]: [string]) => key === 'setting:darkMode',
      )
      expect(calls).toHaveLength(0)
    })

    it('persists darkMode when preferences consent is granted', () => {
      withConsent(true)
      let api: any
      act(() => {
        create(
          <CookieConsentProvider>
            <SettingsProvider>
              <Probe onReady={(a) => { api = a }} />
            </SettingsProvider>
          </CookieConsentProvider>,
        )
      })
      mockStorageSetItemSync.mockClear()

      act(() => api.updateSetting('darkMode', true))

      expect(mockStorageSetItemSync).toHaveBeenCalledWith('setting:darkMode', '1')
    })

    it('still updates in-memory state even without preferences consent', () => {
      withConsent(false)
      let api: any
      act(() => {
        create(
          <CookieConsentProvider>
            <SettingsProvider>
              <Probe onReady={(a) => { api = a }} />
            </SettingsProvider>
          </CookieConsentProvider>,
        )
      })

      act(() => api.updateSetting('darkMode', true))

      expect(api.settings.darkMode).toBe(true)
    })

    it('persists darkMode on native regardless of preferences consent', () => {
      ;(globalThis as any).__resetJestPlatformOS() // switch to native (ios)
      withConsent(false)
      let api: any
      act(() => {
        create(
          <CookieConsentProvider>
            <SettingsProvider>
              <Probe onReady={(a) => { api = a }} />
            </SettingsProvider>
          </CookieConsentProvider>,
        )
      })
      mockStorageSetItemSync.mockClear()

      act(() => api.updateSetting('darkMode', true))

      expect(mockStorageSetItemSync).toHaveBeenCalledWith('setting:darkMode', '1')
    })
  })

  describe('initial darkMode — preferences consent gate (web only)', () => {
    let appearanceSpy: jest.SpyInstance

    beforeEach(() => {
      // Set system colour scheme to light so the system default is false
      appearanceSpy = jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('light')
      // Set storage to have dark mode stored as true ('1')
      ;(Storage.getItemSync as jest.Mock).mockImplementation((key: string) => {
        if (key === 'setting:darkMode') return '1'
        return null
      })
      ;(globalThis as any).__setJestPlatformOS('web')
    })

    afterEach(() => {
      appearanceSpy.mockRestore()
      ;(Storage.getItemSync as jest.Mock).mockReturnValue(null)
      ;(globalThis as any).__resetJestPlatformOS()
    })

    it('on web without preferences consent, uses system scheme even when storage has a value', () => {
      withConsent(false) // preferences: false
      let api: any
      act(() => {
        create(
          <CookieConsentProvider>
            <SettingsProvider>
              <Probe onReady={(a) => { api = a }} />
            </SettingsProvider>
          </CookieConsentProvider>,
        )
      })

      // Storage has '1' (dark) but system is 'light' (false) — should use system
      expect(api.settings.darkMode).toBe(false)
    })

    it('on web with preferences consent, initializes darkMode from storage', () => {
      withConsent(true) // preferences: true
      let api: any
      act(() => {
        create(
          <CookieConsentProvider>
            <SettingsProvider>
              <Probe onReady={(a) => { api = a }} />
            </SettingsProvider>
          </CookieConsentProvider>,
        )
      })

      // Storage has '1' (dark) — should read from storage
      expect(api.settings.darkMode).toBe(true)
    })

    it('on native, initializes darkMode from storage regardless of consent', () => {
      ;(globalThis as any).__resetJestPlatformOS() // switch to native (ios)
      withConsent(false) // preferences: false
      let api: any
      act(() => {
        create(
          <CookieConsentProvider>
            <SettingsProvider>
              <Probe onReady={(a) => { api = a }} />
            </SettingsProvider>
          </CookieConsentProvider>,
        )
      })

      // Storage has '1' (dark) — native should always read from storage
      expect(api.settings.darkMode).toBe(true)
    })
  })

  describe('updateSetting analytics — Crashlytics gate', () => {
    it('calls setCrashlyticsEnabled(true) when analytics is enabled', () => {
      let api: any
      act(() => {
        create(
          <CookieConsentProvider>
            <SettingsProvider>
              <Probe onReady={(a) => { api = a }} />
            </SettingsProvider>
          </CookieConsentProvider>,
        )
      })

      act(() => api.updateSetting('analytics', true))

      expect(crashlyticsService.setCrashlyticsEnabled).toHaveBeenCalledWith(true)
    })

    it('calls setCrashlyticsEnabled(false) when analytics is disabled', () => {
      let api: any
      act(() => {
        create(
          <CookieConsentProvider>
            <SettingsProvider>
              <Probe onReady={(a) => { api = a }} />
            </SettingsProvider>
          </CookieConsentProvider>,
        )
      })

      act(() => api.updateSetting('analytics', false))

      expect(crashlyticsService.setCrashlyticsEnabled).toHaveBeenCalledWith(false)
    })
  })
})
