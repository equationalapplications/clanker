import { httpsCallable } from "firebase/functions"
import { useEffect, useMemo, useCallback } from "react"
import { StyleSheet, View } from "react-native"
import { GiftedChat, User, IMessage, Avatar, Bubble } from "react-native-gifted-chat"
import { useTheme } from "react-native-paper"

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
      avatar: user?.photoURL ?? "https://www.gravatar.com/avatar?d=mp",
    }),
    [uid, user],
  )

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
    },
    [getReply],
  )

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
