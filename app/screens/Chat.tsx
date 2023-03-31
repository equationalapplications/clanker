import { httpsCallable } from "firebase/functions"
import { useMemo, useCallback } from "react"
import { StyleSheet, View } from "react-native"
import { GiftedChat, User, IMessage, Bubble } from "react-native-gifted-chat"
import { useTheme } from "react-native-paper"

import { functions } from "../config/firebaseConfig"
import useMessages from "../hooks/useMessages"
import useUser from "../hooks/useUser"
import useUserPrivate from "../hooks/useUserPrivate"
import { RootTabScreenProps } from "../navigation/types"
import updateMessages from "../utilities/updateMessages"
import { useIsPremium } from "../hooks/useIsPremium"

const getReply: any = httpsCallable(functions, "getReply")

export default function Chat({ navigation }: RootTabScreenProps<"Chat">) {
  const user = useUser()
  const uid = useMemo(() => user?.uid ?? "", [user])
  const userPrivate = useUserPrivate()
  const credits = userPrivate?.credits ?? 0
  const isPremium = useIsPremium()

  const messages = useMessages()
  const { colors, roundness } = useTheme()

  const chatUser = useMemo<User>(
    () => ({
      _id: uid,
      name: user?.displayName ?? "",
      avatar: user?.photoURL ?? "https://www.gravatar.com/avatar?d=mp",
    }),
    [uid, user],
  )

  const onSend = async (messages: IMessage[]) => {
    if (credits <= 0 && !isPremium) {
      navigation.navigate("Subscribe")
      return
    }
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
  }

  const renderBubble = useCallback(
    (props) => {
      return (
        <Bubble
          {...props}
          wrapperStyle={{
            left: { backgroundColor: colors.secondary, borderRadius: roundness },
            right: { backgroundColor: colors.primary, borderRadius: roundness },
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
