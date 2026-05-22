import { useRouter } from 'expo-router'
import { Pressable } from 'react-native'
import { Badge, Text } from 'react-native-paper'
import { useUserCredits } from '../hooks/useUserCredits'

export function CreditCounterIcon() {
  const router = useRouter()
  const { data: credits, isLoading: isCreditsLoading } = useUserCredits()
  const isLoading = isCreditsLoading

  const accessibilityLabel =
    isLoading
      ? 'Credits loading'
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
      <Text>Credits </Text>
      <Badge>{isLoading ? '...' : credits?.totalCredits ?? 0}</Badge>
    </Pressable>
  )
}
