/**
 * @jest-environment node
 */
import type { ConfigPlugin } from '@expo/config-plugins'
import type { ExpoConfig } from 'expo/config'

const GOOGLE_SIGNIN = '@react-native-google-signin/google-signin'

const bareConfig = { _internal: {} } as unknown as ExpoConfig

// Contract check against the REAL installed plugin root. Expo invokes a bare
// string plugin entry with `undefined` options; google-signin 16.2+ selects
// the Firebase config-file path only when options are undefined. If
// google-signin ever changes its options discrimination, these fail first.
describe('google-signin plugin root (real module)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const realPlugin = require(`${GOOGLE_SIGNIN}/app.plugin.js`).default as ConfigPlugin<
    Record<string, string> | undefined
  >

  it('throws on a truthy options object without iosUrlScheme (the trap a bare entry avoids)', () => {
    expect(() =>
      realPlugin(bareConfig, { iosUrlScheme: undefined } as unknown as Record<string, string>),
    ).toThrow(/iosUrlScheme/)
  })

  it('accepts undefined options (Firebase plist path)', () => {
    expect(() => realPlugin(bareConfig, undefined)).not.toThrow()
  })
})

describe('app.config google-signin wiring', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const appConfig = require('../app.config').default as (ctx: {
    config: Record<string, unknown>
  }) => { plugins?: (string | [string, unknown?])[] }

  const plugins = appConfig({ config: {} }).plugins ?? []

  it('uses a bare string entry, never an [name, options] array', () => {
    expect(plugins).toContain(GOOGLE_SIGNIN)
    expect(plugins.some((entry) => Array.isArray(entry) && entry[0] === GOOGLE_SIGNIN)).toBe(false)
  })
})
