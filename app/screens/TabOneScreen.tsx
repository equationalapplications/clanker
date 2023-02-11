import { useState, useCallback } from "react"
import { useAuthSignOut } from "@react-query-firebase/auth"
import { StyleSheet, Button } from "react-native"
import Purchases from "react-native-purchases"
import { useAuthUser } from "@react-query-firebase/auth"
import Constants from "expo-constants"
import { useEffect } from "react"
import { GiftedChat, User, IMessage } from "react-native-gifted-chat"
import { collection, doc, addDoc } from "firebase/firestore"
import {
  useFirestoreDocument,
  useFirestoreTransaction,
} from "@react-query-firebase/firestore"
import { firestore } from "../config/firebaseConfig"

import { getId } from "../utilities/getId"
import { Text, View } from "../components/Themed"
import { auth } from "../config/firebaseConfig"
import { RootTabScreenProps } from "../navigation/types"

export default function TabOneScreen({ navigation }: RootTabScreenProps<"TabOne">) {
  const mutation = useAuthSignOut(auth)
  const user = useAuthUser(["user"], auth)
  const uid = user?.data?.uid ?? ""
  const refMessages = collection(firestore, "messages")

  const [messages, setMessages] = useState<IMessage[]>()
  const [isTyping, setIsTyping] = useState<boolean>(false)

  const chatUser: User = {
    _id: user?.data?.uid ?? 0,
    name: user.data?.displayName ?? "user",
    avatar: "https://gravatar.com/avatar?d=wavatar",
  };

  const chatbotUser: User = {
    _id: 1,
    name: "Chatbot",
    avatar: "https://gravatar.com/avatar?d=robohash",
  };

  useEffect(() => {
    // Configure Purchases
    Purchases.setDebugLogsEnabled(true)
    Purchases.configure({
      apiKey: Constants.expoConfig?.extra?.revenueCatPurchasesApiKey,
      appUserID: user.data?.uid,
      observerMode: false,
      useAmazon: false,
    })
  }, [])


  const onPress = () => {
    mutation.mutate()
  }

  const onSend = useCallback((messages: IMessage[]) => {
    const { _id, createdAt, text, user, } = messages[0]
    addDoc(collection(firestore, 'messages'), { _id, createdAt, text, user });
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Tab One</Text>
      <GiftedChat
        messages={messages}
        onSend={onSend}
        user={chatUser}
        placeholder={"chat with me..."}
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
    alignItems: "center",
    justifyContent: "center",
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
