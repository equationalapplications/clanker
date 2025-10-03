import { useRouter } from "expo-router"
import { Pressable } from "react-native"
import { Badge, Text } from "react-native-paper"

import { useIsPremium } from "../hooks/useIsPremium"
import { useUserCredits } from "../hooks/useUserCredits"

export function CreditCounterIcon() {
  const router = useRouter()
  const { data: credits, isLoading } = useUserCredits()
  const isPremium = useIsPremium()

  return (
    <Pressable
      onPress={() => router.push("./subscribe")}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        opacity: pressed ? 0.5 : 1,
        marginRight: 10,
      })}
    >
      {credits?.hasUnlimited ? (
        <>
          <Text>👑</Text>
          <Text style={{ fontSize: 12, marginLeft: 4 }}>∞</Text>
        </>
      ) : isPremium ? (
        <>
          <Text>👑</Text>
          <Text style={{ fontSize: 12, marginLeft: 4 }}>{credits?.totalCredits || 0}</Text>
        </>
      ) : (
        <>
          <Text>Credits </Text>
          <Badge>{isLoading ? "..." : (credits?.totalCredits || 0)}</Badge>
        </>
      )}
    </Pressable>
  )
}
