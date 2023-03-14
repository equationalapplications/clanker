import { useAuthUser } from "@react-query-firebase/auth"
import {
  useFirestoreQueryData,
  useFirestoreCollectionMutation,
} from "@react-query-firebase/firestore"
import { useFunctionsQuery } from "@react-query-firebase/functions"
import { collection, doc, addDoc } from "firebase/firestore"
import { httpsCallable } from "firebase/functions"
import { useEffect, useState, useCallback } from "react"
import { StyleSheet, Button, View } from "react-native"
import { GiftedChat, User, IMessage, Avatar, Bubble } from "react-native-gifted-chat"
import { useTheme } from "react-native-paper"
import Purchases from "react-native-purchases"

import { firestore, auth, functions } from "../config/firebaseConfig"
import { RootTabScreenProps } from "../navigation/types"

const getReply: any = httpsCallable(functions, "getReply")

export default function Chat({ navigation }: RootTabScreenProps<"Chat">) {
  const [inputText, setInputText] = useState("")
  const user = useAuthUser(["user", auth.currentUser?.uid ?? ""], auth)
  const uid = user?.data?.uid ?? ""
  const messagesRef = collection(firestore, "user_chats", uid, "messages")
  const messagesMutation = useFirestoreCollectionMutation(messagesRef)
  const messagesQuery = useFirestoreQueryData(["messages"], messagesRef, {
    subscribe: true,
  })

  const chatUser: User = {
    _id: uid,
    name: user.data?.displayName ?? "user",
    avatar: user.data?.photoURL ?? undefined,
  }

  useEffect(() => {
    // Configure Purchases
    // Purchases.setDebugLogsEnabled(true)
    // Purchases.configure({
    //   apiKey: Constants.expoConfig?.extra?.revenueCatPurchasesApiKey,
    //   appUserID: uid,
    //   observerMode: false,
    //   useAmazon: false,
    // })
  }, [])

  const onSend = useCallback(async (messages: IMessage[]) => {
    const { _id, createdAt, text, user } = messages[0]
    console.log("createdAt", createdAt)
    const message = {
      _id,
      createdAt: Date.parse(createdAt),
      text,
      user,
    }

    messagesMutation.mutate(message)

    const { data } = await getReply({ message: text })
    const reply = data.reply
    console.log("reply", reply)
  }, [])

  const messages = messagesQuery.data ?? []
  messages.sort((a, b) => b.createdAt - a.createdAt)

  const { colors, roundness } = useTheme()

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          borderRadius: roundness,
          borderColor: colors.outline,
        },
      ]}
    >
      <GiftedChat
        showUserAvatar
        inverted
        messages={messages}
        onSend={onSend}
        user={chatUser}
        placeholder="chat with me..."
        renderUsernameOnMessage
        placeholderTextColor={colors.onSurfaceDisabled}
        textInputStyle={{
          backgroundColor: colors.surface,
          borderColor: colors.outline,
          borderWidth: 1,
          borderRadius: roundness,
          height: 50,
          padding: 10,
          marginHorizontal: 10,
          marginBottom: 10,
        }}
        timeTextStyle={{
          left: { color: colors.onTertiary, fontSize: 12 },
          right: { color: colors.background, fontSize: 12 },
        }}
        renderBubble={(props) => {
          return (
            <Bubble
              {...props}
              wrapperStyle={{
                left: { backgroundColor: colors.tertiary },
                right: { backgroundColor: colors.primary },
              }}
              textStyle={{
                left: { color: colors.onPrimary },
                right: { color: colors.background },
              }}
            />
          )
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 10,
    borderWidth: 1,
    margin: 20,
  },
})
