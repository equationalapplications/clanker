/**
 * @jest-environment node
 */
import type { ConfigPlugin } from '@expo/config-plugins'
import type { ExpoConfig } from 'expo/config'

import withGoogleSignInCompat from '../plugins/withGoogleSignInCompat'

jest.mock('@react-native-google-signin/google-signin/app.plugin.js', () => ({
  __esModule: true,
  default: jest.fn(),
}))

import googleSignInPluginDefault from '@react-native-google-signin/google-signin/app.plugin.js'

const pluginSpy = googleSignInPluginDefault as unknown as jest.Mock

const bareConfig = { _internal: {} } as unknown as ExpoConfig

describe('withGoogleSignInCompat', () => {
  afterEach(() => {
    pluginSpy.mockReset()
  })

  it('delegates to the google-signin plugin root with undefined options (Firebase config-file path)', () => {
    pluginSpy.mockReturnValue(bareConfig)

    // Even when invoked with an options object (e.g. Expo passing `{}` for a
    // string plugin entry, or an app.config array entry whose only key is an
    // unset env var), the wrapper must drop it: google-signin 16.2+ treats any
    // truthy options as "without Firebase config plugin" and hard-errors on a
    // missing hardcoded iosUrlScheme.
    const options = { iosUrlScheme: undefined } as unknown as Record<string, string>
    ;(withGoogleSignInCompat as ConfigPlugin<Record<string, string> | undefined>)(
      bareConfig,
      options,
    )

    expect(pluginSpy).toHaveBeenCalledTimes(1)
    expect(pluginSpy).toHaveBeenCalledWith(bareConfig, undefined)
  })

  it('returns the plugin result unchanged', () => {
    const sentinel = { _internal: {}, sentinel: true } as unknown as ExpoConfig
    pluginSpy.mockReturnValue(sentinel)

    expect(withGoogleSignInCompat(bareConfig)).toBe(sentinel)
  })
})

// Contract check against the REAL installed plugin: these pin the behavior the
// wrapper defends against. If google-signin ever changes its options
// discrimination, these fail first with a clear pointer.
describe('google-signin plugin root (real module)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const realPlugin = jest.requireActual(
    '@react-native-google-signin/google-signin/app.plugin.js',
  ).default as ConfigPlugin<Record<string, string> | undefined>

  it('throws on a truthy options object without iosUrlScheme (the 16.2+ trap the wrapper avoids)', () => {
    expect(() =>
      realPlugin(bareConfig, { iosUrlScheme: undefined } as unknown as Record<string, string>),
    ).toThrow(/iosUrlScheme/)
  })

  it('accepts undefined options (Firebase plist path the wrapper selects)', () => {
    expect(() => realPlugin(bareConfig, undefined)).not.toThrow()
  })
})

describe('app.config google-signin wiring', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const appConfig = require('../app.config').default as (ctx: {
    config: Record<string, unknown>
  }) => { plugins?: Array<string | [string, unknown?]> }

  const plugins = appConfig({ config: {} }).plugins ?? []

  it('wires the local compat wrapper, not the package plugin with options', () => {
    expect(plugins).toContain('./plugins/withGoogleSignInCompat')
    expect(
      plugins.some(
        (entry) =>
          Array.isArray(entry) && entry[0] === '@react-native-google-signin/google-signin',
      ),
    ).toBe(false)
  })
})
