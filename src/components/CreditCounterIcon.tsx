import { useRouter } from 'expo-router'
import { Pressable } from 'react-native'
import { Badge, Text } from 'react-native-paper'
import { useCurrentPlan } from '../hooks/useCurrentPlan'
import { useUserCredits } from '../hooks/useUserCredits'

export function CreditCounterIcon() {
  const router = useRouter()
  const { data: credits, isLoading: creditsLoading } = useUserCredits()
  const { isSubscriber, isLoading: planLoading } = useCurrentPlan()

  const accessibilityLabel =
    creditsLoading || planLoading
      ? 'Subscription status loading'
      : isSubscriber
        ? 'Premium subscriber, unlimited credits'
        : `${credits?.totalCredits ?? 0} credits remaining`

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
      {isSubscriber ? (
        <>
          <Text>👑</Text>
          <Text style={{ fontSize: 12, marginLeft: 4 }}>∞</Text>
        </>
      ) : (
        <>
          <Text>Credits </Text>
          <Badge>{creditsLoading || planLoading ? '...' : credits?.totalCredits || 0}</Badge>
        </>
      )}
    </Pressable>
  )
}
