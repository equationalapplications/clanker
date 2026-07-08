import { useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'
import { useTheme } from 'react-native-paper'
import { useCurrentPlan } from '~/hooks/useCurrentPlan'
import { usePowerBalance, type PowerBand } from '~/hooks/usePowerBalance'

const METER_WIDTH = 44
const METER_HEIGHT = 14
const AMBER_COLOR = '#E6A817'

export function PowerMeter() {
  const router = useRouter()
  const theme = useTheme()
  const { isSubscriber } = useCurrentPlan()
  const { barFill, band, rawFill, isLoading } = usePowerBalance()

  const bandColor: Record<PowerBand, string> = {
    normal: theme.colors.primary,
    amber: AMBER_COLOR,
    red: theme.colors.error,
  }

  const percent = Math.round(rawFill * 100)
  const accessibilityLabel = isLoading
    ? 'Power loading'
    : `Power at ${percent}%${isSubscriber ? ', refills monthly' : ''}`

  return (
    <Pressable
      onPress={() => router.push('/(drawer)/subscribe')}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Opens Power and subscription management"
      style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, marginRight: 10 })}
      testID={isLoading ? 'power-meter-loading' : 'power-meter'}
    >
      <View
        style={{
          width: METER_WIDTH,
          height: METER_HEIGHT,
          borderRadius: METER_HEIGHT / 2,
          borderWidth: 1.5,
          borderColor: theme.colors.outline,
          backgroundColor: theme.colors.surfaceVariant,
          overflow: 'hidden',
          opacity: isLoading ? 0.4 : 1,
        }}
      >
        <View
          testID="power-meter-fill"
          style={{
            width: `${(isLoading ? 0 : barFill) * 100}%`,
            height: '100%',
            backgroundColor: bandColor[band],
          }}
        />
      </View>
    </Pressable>
  )
}
