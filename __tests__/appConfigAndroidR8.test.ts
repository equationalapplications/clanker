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

  it('uses dynamic iOS framework linkage for RNFB 27 (SPM-only Firebase Apple SDK 13+)', () => {
    const { ios } = getBuildProperties()
    // RNFB 27 (Firebase Apple SDK 13+) is distributed only through Swift
    // Package Manager, which requires dynamic framework linkage; the RNFB 26
    // era static-linkage + forceStaticLinking setup is gone (#890).
    expect(ios?.useFrameworks).toBe('dynamic')
    expect(ios).not.toHaveProperty('forceStaticLinking')
  })
})
