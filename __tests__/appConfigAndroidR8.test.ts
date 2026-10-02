/**
 * @jest-environment node
 */
import type { ConfigContext, ExpoConfig } from 'expo/config'

import appConfig from '../app.config'

type BuildPropertiesProps = {
  android?: Record<string, unknown>
  ios?: Record<string, unknown>
}

const getBuildProperties = (): BuildPropertiesProps => {
  const resolved: ExpoConfig = appConfig({ config: {} } as ConfigContext)
  const entry = (resolved.plugins ?? []).find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
  )
  if (!Array.isArray(entry)) {
    throw new Error('expo-build-properties plugin entry with options not found')
  }
  return entry[1] as BuildPropertiesProps
}

describe('app.config expo-build-properties (Android R8)', () => {
  it('enables R8 minification and resource shrinking for release builds', () => {
    const { android } = getBuildProperties()
    expect(android?.enableMinifyInReleaseBuilds).toBe(true)
    expect(android?.enableShrinkResourcesInReleaseBuilds).toBe(true)
  })

  it('does not use the deprecated enableProguardInReleaseBuilds option', () => {
    const { android } = getBuildProperties()
    // android is undefined before the android block is added; toHaveProperty
    // throws on null/undefined, so guard with a defined check first.
    if (android !== undefined) {
      expect(android).not.toHaveProperty('enableProguardInReleaseBuilds')
    } else {
      expect(android).toBeUndefined()
    }
  })

  it('keeps the iOS static-linkage settings unchanged', () => {
    const { ios } = getBuildProperties()
    expect(ios?.useFrameworks).toBe('static')
    expect(ios?.forceStaticLinking).toEqual([
      'RNFBApp',
      'RNFBAuth',
      'RNFBCrashlytics',
      'RNFBFunctions',
      'RNFBAppCheck',
      'RNFBAnalytics',
    ])
  })
})
