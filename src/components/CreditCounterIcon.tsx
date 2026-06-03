import { useRouter } from 'expo-router'
import { Pressable } from 'react-native'
import { Badge, Text } from 'react-native-paper'
import { useCurrentPlan } from '../hooks/useCurrentPlan'
import { useUserCredits } from '../hooks/useUserCredits'

export function CreditCounterIcon() {
  const router = useRouter()
  const { isSubscriber, isLoading: isPlanLoading } = useCurrentPlan()
  const { data: credits, isLoading: isCreditsLoading } = useUserCredits()

  const isLoading = isPlanLoading || isCreditsLoading
  const accessibilityLabel = isLoading
    ? 'Credits loading'
    : `${credits?.totalCredits ?? 0} credits remaining${isSubscriber ? ', monthly plan active' : ''}`

  const badgeContent = isLoading ? '...' : credits?.totalCredits ?? 0

  return (
    <Pressable
      onPress={() => router.push('/(drawer)/subscribe')}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Opens subscription management"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        opacity: pressed ? 0.5 : 1,
        marginRight: 10,
      })}
    >
      <Text>Credits </Text>
      <Badge testID="badge">{badgeContent}</Badge>
    </Pressable>
  )
}
