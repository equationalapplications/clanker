import React from 'react'
import { act, create } from 'react-test-renderer'
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

describe('CookieConsentBanner', () => {
  beforeEach(() => window.localStorage.clear())

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
    // On non-web platform in test env, components return null but don't error
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
})
