import { useRouter } from "expo-router"
import React from "react"
import { Pressable } from "react-native"
import { Badge, Text } from "react-native-paper"

import { useIsPremium } from "../hooks/useIsPremium"
import { useUserPrivate } from "../hooks/useUserPrivate"

export function CreditCounterIcon() {
  const router = useRouter()
  const userPrivate = useUserPrivate()
  const [credits, setCredits] = React.useState(userPrivate?.credits)
  const isPremium = useIsPremium()

  React.useEffect(() => {
    setCredits(userPrivate?.credits)
  }, [userPrivate])

  return (
    <Pressable
      onPress={() => router.push("./subscribe")}
      style={({ pressed }) => ({
        flexDirection: "row",
        opacity: pressed ? 0.5 : 1,
        marginRight: 10,
      })}
    >
      {isPremium ? (
        <>
          <Text>👑</Text>
        </>
      ) : (
        <>
          <Text>Credits </Text>
          <Badge>{credits}</Badge>
        </>
      )}
    </Pressable>
  )
}
