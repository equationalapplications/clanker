import React from 'react'
import { act, create } from 'react-test-renderer'
import {
  CookieConsentProvider,
  useCookieConsent,
} from '~/components/CookieConsent'
import * as crashlyticsService from '~/services/crashlyticsService'

function Probe({ onReady }: { onReady: (api: ReturnType<typeof useCookieConsent>) => void }) {
  const api = useCookieConsent()
  React.useEffect(() => onReady(api), [api, onReady])
  return null
}

describe('CookieConsentContext', () => {
  beforeEach(() => {
    window.localStorage.clear()
    jest.clearAllMocks()
  })

  it('shows banner when no consent exists', () => {
    let api: any
    act(() => {
      create(
        <CookieConsentProvider>
          <Probe onReady={(a) => { api = a }} />
        </CookieConsentProvider>,
      )
    })
    expect(api.isBannerVisible).toBe(true)
    expect(api.canUse('analytics')).toBe(false)
    expect(api.canUse('necessary')).toBe(true)
  })

  it('acceptAll enables all categories and hides banner', () => {
    let api: any
    act(() => {
      create(
        <CookieConsentProvider>
          <Probe onReady={(a) => { api = a }} />
        </CookieConsentProvider>,
      )
    })
    act(() => api.acceptAll())
    expect(api.isBannerVisible).toBe(false)
    expect(api.canUse('analytics')).toBe(true)
    expect(api.canUse('marketing')).toBe(true)
  })

  it('rejectAll keeps only necessary', () => {
    let api: any
    act(() => {
      create(
        <CookieConsentProvider>
          <Probe onReady={(a) => { api = a }} />
        </CookieConsentProvider>,
      )
    })
    act(() => api.rejectAll())
    expect(api.isBannerVisible).toBe(false)
    expect(api.canUse('analytics')).toBe(false)
    expect(api.canUse('necessary')).toBe(true)
  })

  it('savePreferences enforces necessary=true', () => {
    let api: any
    act(() => {
      create(
        <CookieConsentProvider>
          <Probe onReady={(a) => { api = a }} />
        </CookieConsentProvider>,
      )
    })
    act(() => api.savePreferences({ analytics: true, necessary: false as any }))
    expect(api.canUse('necessary')).toBe(true)
    expect(api.canUse('analytics')).toBe(true)
    expect(api.canUse('marketing')).toBe(false)
  })

  it('policyVersion mismatch re-prompts', () => {
    window.localStorage.setItem(
      'cookie:consent:v1',
      JSON.stringify({
        policyVersion: 0,
        consentedAt: '2026-01-01T00:00:00Z',
        expiresAt: '2099-01-01T00:00:00Z',
        regionMode: 'opt-in-strict',
        choices: { necessary: true, analytics: true, marketing: true, preferences: true },
      }),
    )
    let api: any
    act(() => {
      create(
        <CookieConsentProvider>
          <Probe onReady={(a) => { api = a }} />
        </CookieConsentProvider>,
      )
    })
    expect(api.isBannerVisible).toBe(true)
  })

  it('acceptAll calls setCrashlyticsEnabled(true)', () => {
    let api: any
    act(() => {
      create(
        <CookieConsentProvider>
          <Probe onReady={(a) => { api = a }} />
        </CookieConsentProvider>,
      )
    })
    act(() => api.acceptAll())
    expect(crashlyticsService.setCrashlyticsEnabled).toHaveBeenCalledWith(true)
  })

  it('rejectAll calls setCrashlyticsEnabled(false)', () => {
    let api: any
    act(() => {
      create(
        <CookieConsentProvider>
          <Probe onReady={(a) => { api = a }} />
        </CookieConsentProvider>,
      )
    })
    act(() => api.rejectAll())
    expect(crashlyticsService.setCrashlyticsEnabled).toHaveBeenCalledWith(false)
  })

  it('savePreferences calls setCrashlyticsEnabled with the analytics choice', () => {
    let api: any
    act(() => {
      create(
        <CookieConsentProvider>
          <Probe onReady={(a) => { api = a }} />
        </CookieConsentProvider>,
      )
    })
    act(() => api.savePreferences({ analytics: true, marketing: false, preferences: false }))
    expect(crashlyticsService.setCrashlyticsEnabled).toHaveBeenCalledWith(true)

    act(() => api.savePreferences({ analytics: false }))
    expect(crashlyticsService.setCrashlyticsEnabled).toHaveBeenCalledWith(false)
  })

  it('savePreferences enforces necessary:true even when caller passes necessary:false', () => {
    let api: any
    act(() => {
      create(
        <CookieConsentProvider>
          <Probe onReady={(a) => { api = a }} />
        </CookieConsentProvider>,
      )
    })
    act(() => api.savePreferences({ necessary: false, analytics: false, marketing: false, preferences: false }))
    expect(api.canUse('necessary')).toBe(true)
  })
})
