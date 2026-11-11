/**
 * @jest-environment node
 */
import type { ConfigPlugin } from '@expo/config-plugins'
import type { ConfigContext, ExpoConfig } from 'expo/config'

import appConfig from '../app.config'

const GOOGLE_SIGNIN = '@react-native-google-signin/google-signin'

// Fresh config per call: the plugin root is wrapped in createRunOncePlugin, which
// records itself in config._internal.pluginHistory and silently no-ops on any
// later call with the same config — a shared object would make the second
// assertion pass without the plugin body ever running. projectRoot is always
// set by expo-cli; withStaticPlugin asserts on it.
const bareConfig = () => ({ _internal: { projectRoot: process.cwd() } }) as unknown as ExpoConfig

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
      realPlugin(bareConfig(), { iosUrlScheme: undefined } as unknown as Record<string, string>),
    ).toThrow(/iosUrlScheme/)
  })

  it('accepts undefined options (Firebase plist path)', () => {
    const config = bareConfig()
    expect(() => realPlugin(config, undefined)).not.toThrow()
    // Prove the plugin body actually ran (not skipped by run-once).
    expect(config._internal?.pluginHistory?.[GOOGLE_SIGNIN]).toBeDefined()
  })
})

describe('app.config google-signin wiring', () => {
  const plugins = appConfig({ config: {} } as ConfigContext).plugins ?? []

  it('uses a bare string entry, never an [name, options] array', () => {
    expect(plugins).toContain(GOOGLE_SIGNIN)
    expect(plugins.some((entry) => Array.isArray(entry) && entry[0] === GOOGLE_SIGNIN)).toBe(false)
  })
})
