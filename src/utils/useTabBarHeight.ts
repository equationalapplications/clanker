import { createContext, useContext } from 'react'
import type { Context } from 'react'

// expo-router 57 vendors react-navigation but re-exports nothing from
// bottom-tabs at any top-level path, so reading the tab bar height means a deep
// import into `build/`. Two constraints pin the shape of this module:
//
//   * The barrel (`expo-router/build/react-navigation/bottom-tabs`) is NOT a
//     safe substitute for the leaf: it pulls TransitionPresets → TransitionSpecs
//     → native Reanimated bindings into every consumer, which fails outright
//     under Jest and bloats the bundle.
//   * The leaf path is internal, and expo-router ships no `exports` field
//     pinning it, so a patch release can move it.
//
// So the leaf import lives here, once, behind a guard: if the path ever moves,
// consumers fall back to a 0 offset instead of crashing at module load.
const FallbackContext = createContext<number | undefined>(undefined)

function resolveContext(): Context<number | undefined> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-router/build/react-navigation/bottom-tabs/utils/BottomTabBarHeightContext')
    return mod?.BottomTabBarHeightContext ?? FallbackContext
  } catch {
    return FallbackContext
  }
}

const BottomTabBarHeightContext = resolveContext()

/**
 * Height of the bottom tab bar sitting below the current screen, or 0 when
 * there is no tab navigator above it (or the vendored context has moved).
 */
export function useTabBarHeight(): number {
  return useContext(BottomTabBarHeightContext) ?? 0
}
