import { httpsCallable } from "firebase/functions"
import { useMemo, useCallback, useState, useEffect } from "react"
import { StyleSheet, View } from "react-native"
import { GiftedChat, User, IMessage, Bubble } from "react-native-gifted-chat"
import { useTheme } from "react-native-paper"

import { functions } from "../config/firebaseConfig"
import { useChatMessages } from "../hooks/useChatMessages"
import { useIsPremium } from "../hooks/useIsPremium"
import useMessages from "../hooks/useMessages"
import useUser from "../hooks/useUser"
import useUserPrivate from "../hooks/useUserPrivate"
import { BottomTabScreenProps } from "../navigation/types"
import { generateReply } from "../utilities/generateReply"
import { postNewMessage } from "../utilities/postNewMessage"
import updateMessages from "../utilities/updateMessages"

const getReply: any = httpsCallable(functions, "getReply")

export default function Chat({ navigation, route }: BottomTabScreenProps<"Chat">) {
  const id = route.params?.id ?? null
  const userId = route.params?.userId ?? null
  const user = useUser()
  const uid = useMemo(() => user?.uid ?? "", [user])
  const userPrivate = useUserPrivate()
  const credits = userPrivate?.credits ?? 0
  const isPremium = useIsPremium()
  const [characterId, setCharacterId] = useState(id)

  const messagesDefault = useMessages()
  const chatMessages = useChatMessages({ id, userId })

  const messages = id && userId ? chatMessages : messagesDefault

  const { colors, roundness } = useTheme()

  const chatUser = useMemo<User>(
    () => ({
      _id: uid,
      name: user?.displayName ?? "",
      avatar: user?.photoURL ?? "https://www.gravatar.com/avatar?d=mp",
    }),
    [uid, user],
  )

  useEffect(() => {
    if (id && userId) {
      setCharacterId(id)
    } else {
      setCharacterId(userPrivate?.defaultCharacter)
    }
  }, [id, userId])

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
    if (id && userId) {
      // case of mulit-character messaging
      postNewMessage({ id, userId, message })
      const text = message.text
      await generateReply({ id, userId, text })
    } else {
      // case of defaultCharacter messaging
      updateMessages(message)
      const { data } = await getReply({ message: text })
      const reply = data.reply
    }
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
      key={characterId}
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
