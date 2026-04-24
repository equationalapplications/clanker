import React from 'react'
import { act, create } from 'react-test-renderer'
import { CookieConsentProvider } from '~/components/CookieConsent'
import {
  SettingsProvider,
  clearSettings,
  useSettings,
} from '~/contexts/SettingsContext'
import * as crashlyticsService from '../src/services/crashlyticsService'
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

  describe('updateSetting darkMode — preferences consent gate', () => {
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
