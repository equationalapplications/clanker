import { useEffect } from 'react'
import {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
} from 'react-native-reanimated'

// Phase offset per card so each drifts independently (ms)
const FLOAT_PHASE_OFFSET_MS = 550
// Distance of the vertical bob (dp)
const FLOAT_AMPLITUDE_DP = -7
// Duration of each half-cycle of the bob (ms)
const FLOAT_HALF_CYCLE_MS = 2600

/**
 * Returns an animated style that applies a gentle vertical float to a card.
 * Cards are phase-offset by `index` so each drifts independently.
 */
export function useFloatingCardAnimation(index: number) {
  const floatY = useSharedValue(0)

  useEffect(() => {
    floatY.value = withDelay(
      index * FLOAT_PHASE_OFFSET_MS,
      withRepeat(
        withSequence(
          withTiming(FLOAT_AMPLITUDE_DP, { duration: FLOAT_HALF_CYCLE_MS }),
          withTiming(0, { duration: FLOAT_HALF_CYCLE_MS })
        ),
        -1,
        true
      )
    )
  }, [floatY, index])

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: floatY.value }],
  }))

  return animatedStyle
}
