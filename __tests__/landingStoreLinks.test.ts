import fs from 'fs'
import path from 'path'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const siteConfig = require('../src/config/siteConfig')

const ROOT = path.resolve(__dirname, '..')
const LANDING_FILE = path.join(ROOT, 'landing', 'index.html')
const PILLAR_PAGES = [
  'real-time-voice',
  'advanced-memory',
  'privacy-mode',
  'open-source',
  'memory-export-with-okf',
  'image-generation',
  'support',
]

const decode = (s: string) => s.replace(/&amp;/g, '&')

/**
 * The landing page used to send every visitor to the web sign-in and never linked the
 * stores, so site traffic could not become installs. These guard the store CTAs.
 */
describe('landing page store links', () => {
  const html = fs.readFileSync(LANDING_FILE, 'utf8')

  it('links the App Store listing from the hero and the bottom CTA', () => {
    const matches = html.match(/data-store="app_store"/g) ?? []
    expect(matches).toHaveLength(2)
    expect(html).toContain(`https://apps.apple.com/app/id${siteConfig.IOS_APP_STORE_ID}`)
  })

  it('links Google Play with a per-placement install referrer', () => {
    const hrefs = [...html.matchAll(/href="([^"]+)" data-store="google_play"/g)].map((m) =>
      decode(m[1]),
    )
    expect(hrefs).toHaveLength(2)
    const campaigns = hrefs.map((href) => {
      const url = new URL(href)
      expect(url.origin + url.pathname).toBe('https://play.google.com/store/apps/details')
      expect(url.searchParams.get('id')).toBe(siteConfig.ANDROID_PACKAGE)
      const referrer = new URLSearchParams(url.searchParams.get('referrer') ?? '')
      expect(referrer.get('utm_medium')).toBe('landing')
      return referrer.get('utm_campaign')
    })
    expect(campaigns).toEqual(['landing_hero', 'landing_bottom'])
  })

  it('keeps the web app reachable as a secondary option', () => {
    expect(html).toContain('href="/sign-in?redirect=/chat"')
  })

  it.each(['landing', ...PILLAR_PAGES])('%s offers the iOS Smart App Banner', (slug) => {
    const file = slug === 'landing' ? LANDING_FILE : path.join(ROOT, 'public', slug, 'index.html')
    const page = fs.readFileSync(file, 'utf8')
    expect(page).toContain(
      `<meta name="apple-itunes-app" content="app-id=${siteConfig.IOS_APP_STORE_ID}" />`,
    )
  })
})

describe('store URL builders', () => {
  it('sends a plain App Store link while no provider token is configured', () => {
    expect(siteConfig.appStoreUrl('landing_hero')).toBe(
      `https://apps.apple.com/app/id${siteConfig.IOS_APP_STORE_ID}`,
    )
  })

  it('omits the Play referrer when no campaign is given', () => {
    expect(siteConfig.playStoreUrl()).toBe(
      `https://play.google.com/store/apps/details?id=${siteConfig.ANDROID_PACKAGE}`,
    )
  })
})
