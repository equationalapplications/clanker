import React, { useCallback, useState } from 'react'
import { router } from 'expo-router'
import { useNavigation } from 'expo-router/react-navigation'
import { View, Text as RNText, StyleSheet, Platform, TouchableOpacity, Linking } from 'react-native'
import type { FlatListProps, TextStyle } from 'react-native'
import { GiftedChat, Bubble, InputToolbar, Send, MessageText } from 'react-native-gifted-chat'
import type { IMessage, User, ComposerProps, SendProps, InputToolbarProps, MessageTextProps } from 'react-native-gifted-chat'
import { useSelector } from '@xstate/react'
import { useCharacter } from '~/hooks/useCharacters'
import { useAIChat } from '~/hooks/useAIChat'
import { Text, useTheme, Avatar, ActivityIndicator } from 'react-native-paper'
import { useAuthMachine } from '~/hooks/useMachines'
import { useUserCredits } from '~/hooks/useUserCredits'
import CharacterAvatar from '~/components/CharacterAvatar'
import ChatComposer, { type DocumentUploadPhase } from '~/components/ChatComposer'
import { GroundingHtml } from '~/components/GroundingHtml'
import { isSafeHttpUrl } from '~/utils/isSafeHttpUrl'
import { useEntityStatus } from '@equationalapplications/expo-llm-wiki'
import type { GroundedIMessage, Character as AIChatCharacter } from '~/services/aiChatService'
import type { Character } from '~/services/characterService'

const defaultAvatarUrl = 'https://via.placeholder.com/150'

const webMessageTextWrapStyle = {
  wordBreak: 'break-word',
  overflowWrap: 'anywhere',
} as TextStyle

/** Native WebViews in inverted lists can paint over sibling rows unless clipping is disabled. */
const groundingListViewProps: Pick<FlatListProps<unknown>, 'removeClippedSubviews'> | undefined =
  Platform.OS === 'web' ? undefined : { removeClippedSubviews: false }

interface ChatViewProps {
  characterId: string
}

interface ChatViewContentProps {
  characterId: string
  character: Character
  currentUserId: string
  userDisplayName?: string | null
  userPhotoUrl?: string | null
}

function toAIChatCharacter(character: Character): AIChatCharacter {
  return {
    id: character.id,
    name: character.name,
    appearance: character.appearance ?? '',
    traits: character.traits ?? '',
    emotions: character.emotions ?? '',
    context: character.context ?? '',
    cloud_id: character.cloud_id,
    save_to_cloud: character.save_to_cloud ? 1 : 0,
  }
}

function ChatViewContent({
  characterId,
  character,
  currentUserId,
  userDisplayName,
  userPhotoUrl,
}: ChatViewContentProps) {
  const { data: creditsData } = useUserCredits()
  const credits = creditsData?.totalCredits || 0
  const { colors, roundness } = useTheme()

  const wikiStatus = useEntityStatus(characterId)
  const [documentPhase, setDocumentPhase] = useState<DocumentUploadPhase>(null)

  const { messages, sendMessage, escalationState, isGeneratingResponse } = useAIChat({
    characterId,
    userId: currentUserId,
    character: toAIChatCharacter(character),
  })

  const chatUser: User = {
    _id: currentUserId,
    name: userDisplayName || '',
    avatar: userPhotoUrl || defaultAvatarUrl,
  }

  const navigation = useNavigation()

  const handleEdit = useCallback(() => {
    router.push(`/characters/${characterId}/edit`)
  }, [characterId])

  const characterName = character.name || 'Character'

  React.useLayoutEffect(() => {
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
      if (credits <= 0) {
        router.push('/subscribe')
        return
      }

      if (newMessages.length > 0) {
        await sendMessage(newMessages[0])
      }
    },
    [sendMessage, credits],
  )

  const renderBubble = useCallback(
    (props: any) => {
      const hasGrounding = Boolean(
        (props.currentMessage as GroundedIMessage | undefined)?.groundingMetadata,
      )
      const webBubbleConstraints =
        Platform.OS === 'web'
          ? ({ maxWidth: '80%', minWidth: 0, overflow: 'hidden' } as const)
          : {}

      return (
        <Bubble
          {...props}
          touchableProps={
            Platform.OS === 'web' && hasGrounding ? { disabled: true } : undefined
          }
          wrapperStyle={{
            left: {
              backgroundColor: colors.secondary,
              borderRadius: roundness,
              ...webBubbleConstraints,
            },
            right: {
              backgroundColor: colors.primary,
              borderRadius: roundness,
              ...webBubbleConstraints,
            },
          }}
          textStyle={{
            left: { color: colors.onSecondary },
            right: { color: colors.onPrimary },
          }}
          renderMessageText={(msgProps: MessageTextProps<IMessage>) => (
            <View
              style={{
                paddingVertical: 10,
                ...(Platform.OS === 'web' ? { minWidth: 0, maxWidth: '100%' } : {}),
              }}
            >
              <MessageText
                {...msgProps}
                textStyle={
                  Platform.OS === 'web'
                    ? {
                        left: [msgProps.textStyle?.left, webMessageTextWrapStyle],
                        right: [msgProps.textStyle?.right, webMessageTextWrapStyle],
                      }
                    : msgProps.textStyle
                }
              />
            </View>
          )}
        />
      )
    },
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
    (props: SendProps<IMessage>) => {
      if (isGeneratingResponse) {
        return (
          <View
            style={styles.sendSpinnerContainer}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Generating response"
            accessibilityState={{ busy: true }}
          >
            <ActivityIndicator size={20} />
          </View>
        )
      }

      return (
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
      )
    },
    [colors, roundness, isGeneratingResponse],
  )

  const renderComposer = useCallback(
    // GiftedChat currently passes full internal input toolbar props to renderComposer,
    // including onSend from SendProps in addition to ComposerProps.
    (props: ComposerProps & Pick<SendProps<IMessage>, 'onSend'>) => (
      <ChatComposer
        {...props}
        characterId={characterId}
        userId={currentUserId}
        onPhaseChange={setDocumentPhase}
      />
    ),
    [characterId, currentUserId],
  )

  const renderCustomView = useCallback(
    (props: { currentMessage?: GroundedIMessage }) => {
      const metadata = props.currentMessage?.groundingMetadata
      if (!metadata) {
        return null
      }

      const chunks = metadata.groundingChunks ?? []
      const renderedContent = metadata.searchEntryPoint?.renderedContent

      if (chunks.length === 0 && !renderedContent) {
        return null
      }

      return (
        <View style={styles.groundingContainer}>
          {chunks.length > 0 && (
            <View
              style={styles.citationRow}
              accessibilityRole={Platform.OS === 'web' ? ('list' as any) : undefined}
              accessibilityLabel="Search sources"
            >
              {chunks.map((chunk, index) => {
                const uri = chunk.web?.uri
                const title = chunk.web?.title ?? uri
                if (!uri || !title || !isSafeHttpUrl(uri)) {
                  return null
                }
                return (
                  <TouchableOpacity
                    key={`${uri}-${index}`}
                    style={styles.citationChip}
                    onPress={() => {
                      void Linking.openURL(uri).catch((error) => {
                        console.warn('Failed to open citation URL', error)
                      })
                    }}
                    accessibilityRole="link"
                    accessibilityLabel={title}
                  >
                    <RNText style={styles.citationChipText} numberOfLines={1}>
                      {title}
                    </RNText>
                  </TouchableOpacity>
                )
              })}
            </View>
          )}
          {renderedContent && (
            <GroundingHtml html={renderedContent} style={styles.searchSuggestions} />
          )}
        </View>
      )
    },
    [],
  )

  const characterAvatar = character.avatar || defaultAvatarUrl

  return (
    <View style={styles.container}>
      {(wikiStatus.ingesting || wikiStatus.librarian || isGeneratingResponse || documentPhase !== null) && (
        <View
          accessibilityLiveRegion="polite"
          accessibilityRole={Platform.OS === 'web' ? ('status' as any) : undefined}
        >
          {documentPhase === 'reading' && (
            <Text style={styles.statusText} accessibilityLabel="Reading file">⏳ Reading file…</Text>
          )}
          {documentPhase === 'converting' && (
            <Text style={styles.statusText} accessibilityLabel="Converting document">⏳ Converting document…</Text>
          )}
          {documentPhase === 'checking' && (
            <Text style={styles.statusText} accessibilityLabel="Checking for changes">⏳ Checking for changes…</Text>
          )}
          {documentPhase === 'forgetting' && (
            <Text style={styles.statusText} accessibilityLabel="Removing previous version">⏳ Removing previous version…</Text>
          )}
          {wikiStatus.ingesting && (
            <Text style={styles.statusText} accessibilityLabel="Ingesting document">⏳ Ingesting document…</Text>
          )}
          {wikiStatus.librarian && (
            <Text style={styles.statusText} accessibilityLabel="Updating memory">🧠 Updating memory…</Text>
          )}
          {escalationState === 'escalating' && (
            <Text style={styles.statusText} accessibilityLabel="Thinking deeply">🧠 Thinking deeply…</Text>
          )}
          {isGeneratingResponse && escalationState !== 'escalating' && (
            <Text style={styles.statusText} accessibilityLabel="Thinking">💭 Thinking…</Text>
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
        alwaysShowSend={isGeneratingResponse}
        renderCustomView={renderCustomView}
        isCustomViewBottom
        messageIdGenerator={() => `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`}
        listViewProps={groundingListViewProps}
        renderAvatarOnTop
        messagesContainerStyle={styles.messagesContainer}
        minInputToolbarHeight={56}
        renderAvatar={(props) => {
          const isUser = props.currentMessage?.user._id === currentUserId
          const avatarUri = isUser ? (chatUser.avatar as string) : (characterAvatar as string)
          const displayName = userDisplayName?.trim()
          const accessibilityLabel = isUser
            ? (displayName ? `${displayName}'s avatar` : 'Your avatar')
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

export default function ChatView({ characterId }: ChatViewProps) {
  const authService = useAuthMachine()
  const { user } = useSelector(authService, (state) => ({
    user: state.context.user,
  }))
  const currentUserId = user?.uid
  const { data: character, isLoading: characterLoading } = useCharacter(characterId)

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

  return (
    <ChatViewContent
      characterId={characterId}
      character={character}
      currentUserId={currentUserId}
      userDisplayName={user?.displayName}
      userPhotoUrl={user?.photoURL}
    />
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
  sendSpinnerContainer: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
  groundingContainer: {
    paddingHorizontal: 8,
    paddingBottom: Platform.OS === 'web' ? 0 : 8,
    gap: 6,
    overflow: 'hidden',
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
  },
  citationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  citationChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.06)',
    maxWidth: 220,
  },
  citationChipText: {
    fontSize: 12,
  },
  searchSuggestions: {
    backgroundColor: 'transparent',
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    alignSelf: 'stretch',
  },
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
})
