import { useCallback } from "react"
import { StyleSheet, View } from "react-native"
import { GiftedChat, User, IMessage, Bubble } from "react-native-gifted-chat"
import { useTheme, Avatar } from "react-native-paper"
import { useLocalSearchParams } from "expo-router"

import { TitleText } from "../components/StyledText"
import { defaultAvatarUrl, height } from "../config/constants"
import { useCharacter } from "../hooks/useCharacter"
import { useCharacterList } from "../hooks/useCharacterList"
import { useChatMessages } from "../hooks/useChatMessages"
import { useIsPremium } from "../hooks/useIsPremium"
import { useUser } from "../hooks/useUser"
import { useUserPrivate } from "../hooks/useUserPrivate"
import { generateReply } from "../utilities/generateReply"
import { postNewMessage } from "../utilities/postNewMessage"

export default function Chat() {
  const user = useUser()
  const uid = user?.uid
  const userPrivate = useUserPrivate()
  const credits = userPrivate?.credits ?? 0
  const isPremium = useIsPremium()
  const characterList = useCharacterList()
  const params = useLocalSearchParams<{ id?: string; userId?: string }>()
  
  let id = params?.id
  let userId = params?.userId

  if (!id || !userId) {
    id = characterList[0]?.id
    userId = uid
  }

  const character = useCharacter({ id: id!, userId: userId! })
  const characterName = character?.name ?? "Character"
  const characterAvatar = character?.avatar ?? defaultAvatarUrl
  const isCharacterPublic = character?.isCharacterPublic ?? false

  const messages = useChatMessages({ id: id!, userId: userId! })

  const theme = useTheme()

  const renderBubble = (props: any) => {
    return (
      <Bubble
        {...props}
        wrapperStyle={{
          right: {
            backgroundColor: theme.colors.primary,
          },
        }}
      />
    )
  }

  const chatUser: User = {
    _id: uid!,
    name: user?.displayName ?? "User",
    avatar: user?.photoURL ?? defaultAvatarUrl,
  }

  const onSend = useCallback((newMessages: IMessage[] = []) => {
    const message = newMessages[0]
    if (!message || !id || !userId) return

    // Post the user's message
    postNewMessage({ message, id, userId })

    // Generate and post AI reply
    generateReply({
      text: message.text,
      id,
      userId,
    })
  }, [id, userId])

  return (
    <View style={styles.container}>
      {isCharacterPublic ? (
        <>
          <View style={styles.avatarView}>
            <Avatar.Image size={height * 0.1} source={{ uri: characterAvatar }} />
            <TitleText style={styles.titleText}>{characterName}</TitleText>
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
        </>
      ) : (
        <View style={styles.avatarView}>
          <TitleText>This character is set to private.</TitleText>
        </View>
      )}
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
    marginTop: 20,
    marginBottom: 10,
  },
  titleText: {
    marginTop: 10,
    fontSize: 18,
    fontWeight: "bold",
  },
})