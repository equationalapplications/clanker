import React from 'react'
import { act, create } from 'react-test-renderer'
import { Switch } from 'react-native-paper'
import {
  CookieConsentProvider,
  CookieConsentBanner,
  CookiePreferencesModal,
  useCookieConsent,
} from '~/components/CookieConsent'

function ApiProbe({ onReady }: { onReady: (api: ReturnType<typeof useCookieConsent>) => void }) {
  const api = useCookieConsent()
  React.useEffect(() => { onReady(api) }, [api, onReady])
  return null
}

declare const __setJestPlatformOS: (os: string) => void
declare const __resetJestPlatformOS: () => void

describe('CookieConsentBanner', () => {
  beforeEach(() => {
    __setJestPlatformOS('web')
    window.localStorage.clear()
  })
  afterEach(() => __resetJestPlatformOS())

  it('provider renders with banner and modal components', () => {
    let tree: any
    act(() => {
      tree = create(
        <CookieConsentProvider>
          <CookieConsentBanner />
          <CookiePreferencesModal />
        </CookieConsentProvider>,
      )
    })
    // Verify provider and consent components render without error.
    expect(tree).toBeDefined()
  })

  it('acceptAll makes canUse return true for all categories', () => {
    let api: any
    act(() => {
      create(
        <CookieConsentProvider>
          <ApiProbe onReady={(a) => { api = a }} />
        </CookieConsentProvider>,
      )
    })
    expect(api.canUse('analytics')).toBe(false)
    act(() => api.acceptAll())
    expect(api.canUse('analytics')).toBe(true)
    expect(api.canUse('preferences')).toBe(true)
  })

  it('rejectAll keeps only necessary', () => {
    let api: any
    act(() => {
      create(
        <CookieConsentProvider>
          <ApiProbe onReady={(a) => { api = a }} />
        </CookieConsentProvider>,
      )
    })
    act(() => api.rejectAll())
    expect(api.canUse('analytics')).toBe(false)
    expect(api.canUse('necessary')).toBe(true)
  })

  describe('CookiePreferencesModal — strictly necessary toggle', () => {
    it('strictly necessary switch is always disabled and on', () => {
      let api: any
      let tree: any
      act(() => {
        tree = create(
          <CookieConsentProvider>
            <ApiProbe onReady={(a) => { api = a }} />
            <CookiePreferencesModal />
          </CookieConsentProvider>,
        )
      })

      act(() => api.openPreferences())

      const switches = tree.root.findAllByType(Switch)
      const necessarySwitch = switches.find(
        (s: any) => s.props.accessibilityLabel === 'Toggle Strictly necessary',
      )
      expect(necessarySwitch).toBeDefined()
      expect(necessarySwitch.props.disabled).toBe(true)
      expect(necessarySwitch.props.value).toBe(true)
    })

    it('strictly necessary switch stays on even after rejectAll pre-seeds choices', () => {
      let api: any
      let tree: any
      act(() => {
        tree = create(
          <CookieConsentProvider>
            <ApiProbe onReady={(a) => { api = a }} />
            <CookiePreferencesModal />
          </CookieConsentProvider>,
        )
      })

      act(() => api.rejectAll())
      act(() => api.openPreferences())

      const switches = tree.root.findAllByType(Switch)
      const necessarySwitch = switches.find(
        (s: any) => s.props.accessibilityLabel === 'Toggle Strictly necessary',
      )
      expect(necessarySwitch.props.value).toBe(true)
      expect(necessarySwitch.props.disabled).toBe(true)
    })
  })
})
