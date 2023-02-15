import { useAuthSignOut, useAuthUser } from "@react-query-firebase/auth"
import {
  useFirestoreTransaction,
  useFirestoreCollectionMutation,
} from "@react-query-firebase/firestore"
import { useFunctionsQuery } from "@react-query-firebase/functions"
import Constants from "expo-constants"
import { collection } from "firebase/firestore"
import { httpsCallable } from "firebase/functions"
import { useEffect, useState, useCallback } from "react"
import { StyleSheet, Button } from "react-native"
import { GiftedChat, User, IMessage } from "react-native-gifted-chat"
import Purchases from "react-native-purchases"

import { Text, View } from "../components/Themed"
import { firestore, auth, functions } from "../config/firebaseConfig"
import { RootTabScreenProps } from "../navigation/types"

const getReply = httpsCallable(functions, "getReply")

export default function TabOneScreen({ navigation }: RootTabScreenProps<"TabOne">) {
  const authMutation = useAuthSignOut(auth)
  const user = useAuthUser(["user"], auth)
  const uid = user?.data?.uid ?? ""
  const messagesRef = collection(firestore, "messages")
  const messagesMutation = useFirestoreCollectionMutation(messagesRef)
  const getReplyQuery = useFunctionsQuery("reply", functions, "getReply", "who are you?")

  const [messages, setMessages] = useState<IMessage[]>()
  const [isTyping, setIsTyping] = useState<boolean>(false)

  const chatUser: User = {
    _id: uid,
    name: user.data?.displayName ?? "user",
    avatar: "https://gravatar.com/avatar?d=wavatar",
  }

  const chatbotUser: User = {
    _id: 1,
    name: "Chatbot",
    avatar: "https://gravatar.com/avatar?d=robohash",
  }

  useEffect(() => {
    // Configure Purchases
    Purchases.setDebugLogsEnabled(true)
    Purchases.configure({
      apiKey: Constants.expoConfig?.extra?.revenueCatPurchasesApiKey,
      appUserID: uid,
      observerMode: false,
      useAmazon: false,
    })
  }, [])

  const onPress = () => {
    authMutation.mutate()
  }

  const onSend = useCallback(async (messages: IMessage[]) => {
    console.log("onSend", messages)
    setMessages((previousMessages) => GiftedChat.append(previousMessages, messages))
    const { _id, createdAt, text, user } = messages[0]
    messagesMutation.mutate({
      _id,
      createdAt,
      text,
      user,
    })
    const reply = await getReply({ text })
    console.log("reply", reply.data)
  }, [])

  return (
    <View style={styles.container}>
      {messagesMutation.isError && <Text>{messagesMutation.error.message}</Text>}
      <GiftedChat
        messages={messages}
        onSend={onSend}
        user={chatUser}
        placeholder="chat with me..."
        isTyping={isTyping}
      />
      <View style={styles.separator} lightColor="#eee" darkColor="rgba(255,255,255,0.1)" />
      <Button title="Sign Out" onPress={onPress} />
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
