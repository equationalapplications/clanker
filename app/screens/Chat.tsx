import { httpsCallable } from "firebase/functions"
import { useEffect, useMemo, useCallback } from "react"
import { StyleSheet, View } from "react-native"
import { GiftedChat, User, IMessage, Avatar, Bubble } from "react-native-gifted-chat"
import { useTheme } from "react-native-paper"
import Purchases from "react-native-purchases"

import { functions } from "../config/firebaseConfig"
import useMessages from "../hooks/useMessages"
import useUser from "../hooks/useUser"
import { RootTabScreenProps } from "../navigation/types"
import updateMessages from "../utilities/updateMessages"

const getReply: any = httpsCallable(functions, "getReply")

export default function Chat({ navigation }: RootTabScreenProps<"Chat">) {
  const user = useUser()
  const uid = useMemo(() => user?.uid ?? "", [user])
  const messages = useMessages()
  const { colors, roundness } = useTheme()

  const chatUser = useMemo<User>(
    () => ({
      _id: uid,
      name: user?.displayName ?? "",
      avatar: user?.photoURL ?? "",
    }),
    [uid, user],
  )

  useEffect(() => {
    // Configure Purchases
    // Purchases.setDebugLogsEnabled(true)
    // Purchases.configure({
    //   apiKey: Constants.expoConfig?.extra?.revenueCatPurchasesApiKey,
    //   appUserID: uid,
    //   observerMode: false,
    //   useAmazon: false,
    // })
  }, [uid])

  const onSend = useCallback(
    async (messages: IMessage[]) => {
      const { _id, createdAt, text, user } = messages[0]
      const message = {
        _id,
        createdAt: Date.parse(createdAt),
        text,
        user,
      }
      updateMessages(message)
      const { data } = await getReply({ message: text })
      const reply = data.reply
      console.log("reply", reply)
    },
    [getReply],
  )

  const renderBubble = useCallback(
    (props) => {
      return (
        <Bubble
          {...props}
          wrapperStyle={{
            left: { backgroundColor: colors.secondary },
            right: { backgroundColor: colors.primary },
          }}
          textStyle={{
            left: { color: colors.onSecondary },
            right: { color: colors.onPrimary },
          }}
        />
      )
    },
    [colors],
  )

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
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
        renderBubble={renderBubble}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 10,
  },
})
