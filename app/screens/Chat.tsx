import { useAuthUser } from "@react-query-firebase/auth"
import {
  useFirestoreTransaction,
  useFirestoreDocumentMutation,
  useFirestoreQueryData,
  useFirestoreCollectionMutation,
} from "@react-query-firebase/firestore"
import { useFunctionsQuery } from "@react-query-firebase/functions"
import Constants from "expo-constants"
import { collection, doc, addDoc } from "firebase/firestore"
import { httpsCallable } from "firebase/functions"
import { useEffect, useState, useCallback } from "react"
import { StyleSheet, Button } from "react-native"
import { GiftedChat, User, IMessage } from "react-native-gifted-chat"
import Purchases from "react-native-purchases"

import { Text, View } from "../components/Themed"
import { firestore, auth, functions } from "../config/firebaseConfig"
import { RootTabScreenProps } from "../navigation/types"

const getReply: any = httpsCallable(functions, "getReply")

export default function Chat({ navigation }: RootTabScreenProps<"Chat">) {
  const user = useAuthUser(["user"], auth)
  const uid = user?.data?.uid ?? ""
  const messagesRef = collection(firestore, "user_chats", uid, "messages")
  const messagesMutation = useFirestoreCollectionMutation(messagesRef)
  const messagesQuery = useFirestoreQueryData(["messages"], messagesRef, {
    subscribe: true,
  })

  //const [messages, setMessages] = useState<IMessage[]>()
  //const [isTyping, setIsTyping] = useState<boolean>(false)

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
    //setMessages((previousMessages) => GiftedChat.append(previousMessages, messages))
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

  return (
    <View style={styles.container}>
      {/*messagesMutation.isError && <Text>{messagesMutation.error.message}</Text>*/}
      <GiftedChat
        showUserAvatar={true}
        inverted={true}
        messages={messages}
        onSend={onSend}
        user={chatUser}
        placeholder="chat with me..."
      //isTyping={isTyping}
      />

    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
  },
  separator: {
    marginVertical: 30,
    height: 1,
    width: "80%",
  },
})
