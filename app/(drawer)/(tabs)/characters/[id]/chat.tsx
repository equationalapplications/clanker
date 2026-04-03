import { useLocalSearchParams, router , Stack } from 'expo-router'
import { View, StyleSheet, Platform } from 'react-native'
import { GiftedChat, IMessage, User, Bubble } from 'react-native-gifted-chat'
import { useCallback } from 'react'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { useSelector } from '@xstate/react'
import { useCharacter } from '~/hooks/useCharacters'
import { useChatMessages } from '~/hooks/useMessages'
import { useAIChat } from '~/hooks/useAIChat'
import { Text, useTheme, Avatar , Button } from 'react-native-paper'
import { useAuthMachine } from '~/hooks/useMachines'
import { useUserCredits } from '~/hooks/useUserCredits'

const defaultAvatarUrl = 'https://via.placeholder.com/150'

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const authService = useAuthMachine()
  const { user } = useSelector(authService, (state) => ({
    user: state.context.user,
  }))
  const currentUserId = user?.uid
  const { data: character, isLoading: characterLoading } = useCharacter(id || '')
  const messages = useChatMessages({ id: id || '', userId: currentUserId || '' })
  const { data: creditsData } = useUserCredits()
  const credits = creditsData?.totalCredits || 0
  const hasUnlimited = creditsData?.hasUnlimited || false
  const { colors, roundness } = useTheme()

  const { sendMessage } = useAIChat({
    characterId: id || '',
    userId: currentUserId || '',
    character: character as any, // Type compatibility - character structure matches
  })

  const chatUser: User = {
    _id: currentUserId || '',
    name: user?.displayName || '',
    avatar: user?.photoURL || defaultAvatarUrl,
  }

  const handleEdit = () => {
    router.push(`/characters/${id}/edit`)
  }

  const handleSend = useCallback(
    async (newMessages: IMessage[] = []) => {
      if (!currentUserId || !character) return

      // Check credits before sending (unless user has unlimited)
      if (credits <= 0 && !hasUnlimited) {
        router.push('/subscribe')
        return
      }

      if (newMessages.length > 0) {
        const message = newMessages[0]
        await sendMessage(message)
      }
    },
    [sendMessage, currentUserId, character, credits, hasUnlimited],
  )

  const renderBubble = useCallback(
    (props: any) => {
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
    [colors, roundness],
  )

  if (characterLoading || !character) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Loading character...</Text>
      </View>
    )
  }

  if (!currentUserId) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Please sign in to chat</Text>
      </View>
    )
  }

  const characterAvatar = character.avatar || defaultAvatarUrl
  const characterName = character.name || 'Character'

  // Note: Privacy check removed - all local characters are owned by the user
  // Privacy will be relevant later when implementing cloud sync and sharing features

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: characterName,
          headerRight: () => <Button onPress={handleEdit}>Edit</Button>,
        }}
      />
      <View style={styles.container}>
        <GiftedChat
          messages={messages}
          onSend={handleSend}
          user={chatUser}
          renderBubble={renderBubble}
          renderAvatarOnTop
          messagesContainerStyle={styles.messagesContainer}
          renderAvatar={(props) => {
            const avatarUri =
              props.currentMessage?.user._id === currentUserId
                ? (chatUser.avatar as string)
                : (characterAvatar as string)
            return (
              <Avatar.Image
                size={36}
                source={{
                  uri: avatarUri,
                }}
              />
            )
          }}
        />
        {Platform.OS === 'android' && <KeyboardAvoidingView behavior="padding" />}
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarView: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  titleText: {
    marginTop: 10,
  },
  chatContainer: {
    flex: 1,
  },
  messagesContainer: {
    flex: 1,
  },
})
