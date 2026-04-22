import { router, Stack } from 'expo-router'
import { View, StyleSheet, Platform, TouchableOpacity } from 'react-native'
import { GiftedChat, IMessage, User, Bubble, ComposerProps, SendProps } from 'react-native-gifted-chat'
import { useCallback } from 'react'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { useSelector } from '@xstate/react'
import { useCharacter } from '~/hooks/useCharacters'
import { useChatMessages } from '~/hooks/useMessages'
import { useAIChat } from '~/hooks/useAIChat'
import { Text, useTheme, Avatar } from 'react-native-paper'
import { useAuthMachine } from '~/hooks/useMachines'
import { useUserCredits } from '~/hooks/useUserCredits'
import CharacterAvatar from '~/components/CharacterAvatar'
import ChatComposer from '~/components/ChatComposer'

const defaultAvatarUrl = 'https://via.placeholder.com/150'

interface ChatViewProps {
  characterId: string
}

export default function ChatView({ characterId }: ChatViewProps) {
  const authService = useAuthMachine()
  const { user } = useSelector(authService, (state) => ({
    user: state.context.user,
  }))
  const currentUserId = user?.uid
  const { data: character, isLoading: characterLoading } = useCharacter(characterId)
  const messages = useChatMessages({ id: characterId, userId: currentUserId || '' })
  const { data: creditsData } = useUserCredits()
  const credits = creditsData?.totalCredits || 0
  const hasUnlimited = creditsData?.hasUnlimited || false
  const { colors, roundness } = useTheme()

  const { sendMessage } = useAIChat({
    characterId,
    userId: currentUserId || '',
    character: character as any, // Type compatibility - character structure matches
  })

  const chatUser: User = {
    _id: currentUserId || '',
    name: user?.displayName || '',
    avatar: user?.photoURL || defaultAvatarUrl,
  }

  const handleEdit = () => {
    router.push(`/characters/${characterId}/edit`)
  }

  const handleSend = useCallback(
    async (newMessages: IMessage[] = []) => {
      if (!currentUserId || !character) return

      if (credits <= 0 && !hasUnlimited) {
        router.push('/subscribe')
        return
      }

      if (newMessages.length > 0) {
        await sendMessage(newMessages[0])
      }
    },
    [sendMessage, currentUserId, character, credits, hasUnlimited],
  )

  const renderBubble = useCallback(
    (props: any) => (
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
    ),
    [colors, roundness],
  )

  const renderComposer = useCallback(
    // GiftedChat currently passes full internal input toolbar props to renderComposer,
    // including onSend from SendProps in addition to ComposerProps.
    (props: ComposerProps & Pick<SendProps<IMessage>, 'onSend'>) => <ChatComposer {...props} />,
    [],
  )

  if (characterLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Loading character...</Text>
      </View>
    )
  }

  if (!character) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Character not found.</Text>
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

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackVisible: false,
          headerTitle: () => (
            <View style={styles.headerTitle}>
              <TouchableOpacity
                onPress={handleEdit}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${characterName}`}
                accessibilityHint="Opens the character editor"
              >
                <CharacterAvatar size={40} imageUrl={character.avatar} characterName={characterName} />
              </TouchableOpacity>
              <Text variant="titleMedium" numberOfLines={1}>
                {characterName}
              </Text>
            </View>
          ),
        }}
      />
      <View style={styles.container}>
        <GiftedChat
          messages={messages}
          onSend={handleSend}
          user={chatUser}
          renderComposer={renderComposer}
          renderBubble={renderBubble}
          renderAvatarOnTop
          messagesContainerStyle={styles.messagesContainer}
          renderAvatar={(props) => {
            const avatarUri =
              props.currentMessage?.user._id === currentUserId
                ? (chatUser.avatar as string)
                : (characterAvatar as string)
            return <Avatar.Image size={36} source={{ uri: avatarUri }} />
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
  messagesContainer: {
    flex: 1,
  },
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
})
