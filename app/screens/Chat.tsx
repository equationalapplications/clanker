import { useCallback, useState } from "react"
import { StyleSheet, View } from "react-native"
import { GiftedChat, User, IMessage, Bubble } from "react-native-gifted-chat"
import { useTheme, Avatar } from "react-native-paper"

import { TitleText } from "../components/StyledText"
import { defaultAvatarUrl } from "../config/constants"
import useCharacter from "../hooks/useCharacter"
import { useCharacterList } from "../hooks/useCharacterList"
import { useChatMessages } from "../hooks/useChatMessages"
import { useIsPremium } from "../hooks/useIsPremium"
import { useUser } from "../hooks/useUser"
import { useUserPrivate } from "../hooks/useUserPrivate"
import { BottomTabScreenProps } from "../navigation/types"
import { generateReply } from "../utilities/generateReply"
import { postNewMessage } from "../utilities/postNewMessage"

export default function Chat({ navigation, route }: BottomTabScreenProps<"Chat">) {
  const user = useUser()
  const uid = user?.uid
  const userPrivate = useUserPrivate()
  const credits = userPrivate?.credits ?? 0
  const isPremium = useIsPremium()
  const characterList = useCharacterList()
  let id = route.params?.id
  let userId = route.params?.userId

  if (!id || !userId) {
    id = characterList[0]?.id
    userId = uid
  }

  const character = useCharacter({ id, userId: uid })
  const avatar = character?.avatar ?? defaultAvatarUrl
  const messages = useChatMessages({ id, userId })

  const { colors, roundness } = useTheme()

  const chatUser: User = {
    _id: uid,
    name: user?.displayName ?? "",
    avatar: user?.photoURL ?? defaultAvatarUrl,
  }

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
    postNewMessage({ id, userId, message })
    await generateReply({ id, userId, text })
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
    <View style={styles.container}>
      <View style={styles.avatarView}>
        <Avatar.Image size={256} source={{ uri: avatar }} />
        <TitleText style={styles.titleText}>{character?.name}</TitleText>
      </View>
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
    flex: 1,
  },
  avatarView: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 30,
  },
  titleText: {
    marginTop: 10,
  },
})
