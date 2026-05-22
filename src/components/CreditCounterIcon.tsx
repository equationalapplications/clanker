import { useRouter } from 'expo-router'
import { Pressable } from 'react-native'
import { Badge, Text } from 'react-native-paper'
import { useCurrentPlan } from '~/hooks/useCurrentPlan'
import { useUserCredits } from '../hooks/useUserCredits'

export function CreditCounterIcon() {
  const router = useRouter()
  const { data: credits, isLoading: isCreditsLoading } = useUserCredits()
  const { isSubscriber, isLoading: isPlanLoading } = useCurrentPlan()
  const isLoading = isCreditsLoading || isPlanLoading

  const accessibilityLabel =
    isLoading
      ? 'Credits loading'
      : `${credits?.totalCredits ?? 0} credits remaining`

  const badgeContent = isPlanLoading ? '...' : isSubscriber ? '∞' : credits?.totalCredits ?? 0
  const showBadge = !isSubscriber || isPlanLoading

  return (
    <Pressable
      onPress={() => router.push('./subscribe')}
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
      {showBadge ? <Badge>{badgeContent}</Badge> : <Text>{badgeContent}</Text>}
    </Pressable>
  )
}
