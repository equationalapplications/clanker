import React, { useCallback } from 'react'
import { router } from 'expo-router'
import { useNavigation } from "expo-router/react-navigation"
import { View, Text as RNText, StyleSheet, Platform, TouchableOpacity } from 'react-native'
import { GiftedChat, Bubble, InputToolbar, Send, MessageText } from 'react-native-gifted-chat'
import type { IMessage, User, ComposerProps, SendProps, InputToolbarProps, MessageTextProps } from 'react-native-gifted-chat'
import { useSelector } from '@xstate/react'
import { useCharacter } from '~/hooks/useCharacters'
import { useChatMessages } from '~/hooks/useMessages'
import { useAIChat } from '~/hooks/useAIChat'
import { Text, useTheme, Avatar } from 'react-native-paper'
import { useAuthMachine } from '~/hooks/useMachines'
import { useUserCredits } from '~/hooks/useUserCredits'
import CharacterAvatar from '~/components/CharacterAvatar'
import ChatComposer from '~/components/ChatComposer'
import { useCharacterWiki } from '~/hooks/useCharacterWiki'

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
  const { colors, roundness } = useTheme()

  const { status: wikiStatus } = useCharacterWiki(characterId)

  const { sendMessage, escalationState } = useAIChat({
    characterId,
    userId: currentUserId || '',
    character: character as any, // Type compatibility - character structure matches
  })

  const chatUser: User = {
    _id: currentUserId || '',
    name: user?.displayName || '',
    avatar: user?.photoURL || defaultAvatarUrl,
  }

  const navigation = useNavigation()

  const handleEdit = useCallback(() => {
    router.push(`/characters/${characterId}/edit`)
  }, [characterId])

  const characterName = character?.name || 'Character'

  React.useLayoutEffect(() => {
    if (!character) return
    const drawerNav = navigation.getParent?.()?.getParent?.()
    if (!drawerNav) return
    
    const setHeader = () => {
      drawerNav?.setOptions({
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
      })
    }
    
    setHeader()
    
    const unsubscribeFocus = navigation.addListener?.('focus', setHeader)
    const unsubscribeBlur = navigation.addListener?.('blur', () => {
      drawerNav?.setOptions({ headerTitle: 'Chat' })
    })
    
    return () => {
      unsubscribeFocus?.()
      unsubscribeBlur?.()
      drawerNav?.setOptions({ headerTitle: 'Chat' })
    }
  }, [character, characterName, handleEdit, navigation])

  const handleSend = useCallback(
    async (newMessages: IMessage[] = []) => {
      if (!currentUserId || !character) return

      if (credits <= 0) {
        router.push('/subscribe')
        return
      }

      if (newMessages.length > 0) {
        await sendMessage(newMessages[0])
      }
    },
    [sendMessage, currentUserId, character, credits],
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
        renderMessageText={(msgProps: MessageTextProps<IMessage>) => (
          <View style={{ paddingVertical: 10 }}>
            <MessageText {...msgProps} />
          </View>
        )}
      />
    ),
    [colors, roundness],
  )

  const renderInputToolbar = useCallback(
    (props: InputToolbarProps<IMessage>) => (
      <InputToolbar
        {...props}
        containerStyle={{
          backgroundColor: colors.surface,
          borderTopColor: colors.outlineVariant,
          borderTopWidth: StyleSheet.hairlineWidth,
          paddingHorizontal: 8,
          paddingVertical: 4,
        }}
      />
    ),
    [colors],
  )

  const renderSend = useCallback(
    (props: SendProps<IMessage>) => (
      <Send
        {...props}
        containerStyle={{ justifyContent: 'center', alignSelf: 'center', marginRight: 4 }}
        sendButtonProps={{
          accessibilityLabel: 'Send message',
          accessibilityRole: 'button',
        }}
      >
        <View
          style={{
            backgroundColor: colors.primaryContainer,
            borderRadius: roundness * 4,
            paddingHorizontal: 14,
            paddingVertical: 8,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <RNText style={{ color: colors.onPrimaryContainer, fontWeight: '600', fontSize: 15 }}>
            Send
          </RNText>
        </View>
      </Send>
    ),
    [colors, roundness],
  )

  const renderComposer = useCallback(
    // GiftedChat currently passes full internal input toolbar props to renderComposer,
    // including onSend from SendProps in addition to ComposerProps.
    (props: ComposerProps & Pick<SendProps<IMessage>, 'onSend'>) => (
      <ChatComposer {...props} characterId={characterId} userId={currentUserId ?? undefined} />
    ),
    [characterId, currentUserId],
  )

  if (characterLoading) {
    return (
      <View
        style={styles.loadingContainer}
        accessible
        accessibilityRole={Platform.OS === 'web' ? ('status' as any) : undefined}
        accessibilityLiveRegion="polite"
        accessibilityLabel="Loading character"
      >
        <Text>Loading character...</Text>
      </View>
    )
  }

  if (!character) {
    return (
      <View
        style={styles.loadingContainer}
        accessible
        accessibilityRole={Platform.OS === 'web' ? ('status' as any) : undefined}
        accessibilityLiveRegion="polite"
        accessibilityLabel="Character not found"
      >
        <Text>Character not found.</Text>
      </View>
    )
  }

  if (!currentUserId) {
    return (
      <View
        style={styles.loadingContainer}
        accessible
        accessibilityRole={Platform.OS === 'web' ? ('status' as any) : undefined}
        accessibilityLiveRegion="polite"
        accessibilityLabel="Please sign in to chat"
      >
        <Text>Please sign in to chat</Text>
      </View>
    )
  }

  const characterAvatar = character.avatar || defaultAvatarUrl

  return (
    <View style={styles.container}>
        {(wikiStatus.ingesting || wikiStatus.librarian || escalationState === 'escalating') && (
          <View
            accessibilityLiveRegion="polite"
            accessibilityRole={Platform.OS === 'web' ? ('status' as any) : undefined}
          >
            {wikiStatus.ingesting && (
              <Text style={styles.statusText} accessibilityLabel="Ingesting document">⏳ Ingesting document…</Text>
            )}
            {wikiStatus.librarian && (
              <Text style={styles.statusText} accessibilityLabel="Updating memory">🧠 Updating memory…</Text>
            )}
            {escalationState === 'escalating' && (
              <Text style={styles.statusText} accessibilityLabel="Thinking deeply">🧠 Thinking deeply…</Text>
            )}
          </View>
        )}
        <GiftedChat
          messages={messages}
          onSend={handleSend}
          user={chatUser}
          renderComposer={renderComposer}
          renderBubble={renderBubble}
          renderInputToolbar={renderInputToolbar}
          renderSend={renderSend}
          renderAvatarOnTop
          messagesContainerStyle={styles.messagesContainer}
          minInputToolbarHeight={56}
          renderAvatar={(props) => {
            const isUser = props.currentMessage?.user._id === currentUserId
            const avatarUri = isUser ? (chatUser.avatar as string) : (characterAvatar as string)
            const userDisplayName = user?.displayName?.trim()
            const accessibilityLabel = isUser
              ? (userDisplayName ? `${userDisplayName}'s avatar` : 'Your avatar')
              : `${characterName}'s avatar`
            return (
              <Avatar.Image
                accessible
                accessibilityRole="image"
                size={36}
                source={{ uri: avatarUri }}
                accessibilityLabel={accessibilityLabel}
              />
            )
          }}
        />
    </View>
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
  statusText: {
    textAlign: 'center',
    paddingVertical: 4,
    fontSize: 12,
    opacity: 0.7,
  },
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
})
