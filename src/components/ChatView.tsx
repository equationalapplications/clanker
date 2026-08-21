import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { router } from 'expo-router'
import { useNavigation } from 'expo-router/react-navigation'
import { Keyboard, View, StyleSheet, Platform, TouchableOpacity } from 'react-native'
import { useSelector } from '@xstate/react'
import { useCharacter } from '~/hooks/useCharacters'
import { useResolvedImage } from '~/hooks/useResolvedImage'
import { useAIChat } from '~/hooks/useAIChat'
import { Text, useTheme, Avatar } from 'react-native-paper'
import { useAuthMachine } from '~/hooks/useMachines'
import { usePowerBalance } from '~/hooks/usePowerBalance'
import CharacterAvatar from '~/components/CharacterAvatar'
import type { DocumentUploadPhase } from '~/components/ChatComposer'
import { ChatInputBar } from '~/components/ChatInputBar'
import { MessageList } from '~/components/MessageList'
import { LowPowerBanner } from '~/components/LowPowerBanner'
import { useEntityStatus } from '@equationalapplications/expo-llm-wiki'
import type { Character as AIChatCharacter } from '~/services/aiChatService'
import type { Message, ChatUser } from '~/types/chat'
import type { Character } from '~/services/characterService'
import { setActiveCharacterId } from '~/hooks/useActiveCharacterId'
import type { PendingChatPhoto } from '~/hooks/useChatPhotoUpload'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'

function getInitials(name?: string): string {
  return (
    name
      ?.trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('') || '?'
  ).toUpperCase()
}

function toolStatusLabel(toolName: string): string {
  switch (toolName) {
    case 'wiki_read':
      return '⏳ Reading your memory…'
    case 'google_search':
      return '⏳ Searching the web…'
    case 'wiki_write':
      return '⏳ Updating memory…'
    case 'document_search':
      return '⏳ Searching documents…'
    default:
      return `⏳ Using ${toolName.replace(/_/g, ' ')}…`
  }
}

function toolStatusAccessibilityLabel(toolName: string): string {
  switch (toolName) {
    case 'wiki_read':
      return 'Reading your memory'
    case 'google_search':
      return 'Searching the web'
    case 'wiki_write':
      return 'Updating memory'
    case 'document_search':
      return 'Searching documents'
    default:
      return `Using ${toolName.replace(/_/g, ' ')}`
  }
}

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

export function ChatViewContent({
  characterId,
  character,
  currentUserId,
  userDisplayName,
  userPhotoUrl,
}: ChatViewContentProps) {
  const { totalPower: credits, isLoading: creditsLoading } = usePowerBalance()
  const { colors } = useTheme()
  // KeyboardAvoidingView from react-native-keyboard-controller computes the
  // keyboard overlap as `frame.y + frame.height - keyboardTop` and adds
  // `keyboardVerticalOffset` on top, so landing exactly on the keyboard
  // requires an offset equal to this view's screen-absolute top (status bar +
  // header); the tab bar below the view then cancels out on its own. The
  // built-in `automaticOffset` prop measures that natively, but its
  // viewPositionInWindow call rejects while the screen is still transitioning
  // in and the component silently falls back to parent-relative coordinates —
  // leaving the composer behind the keyboard by exactly the header height
  // (upstream kirillzyusko/react-native-keyboard-controller#1594). The same
  // delta is measured in JS instead: absolute y from measureInWindow minus the
  // onLayout y, re-measured whenever the keyboard opens. Behavior must stay a
  // concrete supported value — with `undefined` the component emits an empty
  // style and never avoids at all. iOS keeps `padding`; Android uses
  // `translate-with-padding`.
  const keyboardAvoidingRef = useRef<View>(null)
  const keyboardAvoidingRelativeY = useRef(0)
  const [keyboardAvoidingOffset, setKeyboardAvoidingOffset] = useState(0)

  const remeasureKeyboardAvoidingOffset = useCallback(() => {
    keyboardAvoidingRef.current?.measureInWindow((_x, y) => {
      const next = Math.max(0, Math.round(y - keyboardAvoidingRelativeY.current))
      setKeyboardAvoidingOffset((prev) => (prev === next ? prev : next))
    })
  }, [])

  useEffect(() => {
    // iOS emits `keyboardWillShow`; Android emits `keyboardDidShow`.
    const subscriptions = [
      Keyboard.addListener('keyboardWillShow', remeasureKeyboardAvoidingOffset),
      Keyboard.addListener('keyboardDidShow', remeasureKeyboardAvoidingOffset),
    ]
    return () => subscriptions.forEach((subscription) => subscription.remove())
  }, [remeasureKeyboardAvoidingOffset])

  const wikiStatus = useEntityStatus(characterId)
  const [documentPhase, setDocumentPhase] = useState<DocumentUploadPhase>(null)

  const {
    messages,
    sendMessage,
    sendPhoto,
    canSendPhoto,
    escalationState,
    isGeneratingResponse,
    activeTool,
    streamingMessage,
    error: chatError,
  } = useAIChat({
    characterId,
    userId: currentUserId,
    character: toAIChatCharacter(character),
  })

  // While a turn is streaming, the refetch may deliver the persisted row before
  // the hook clears the streamed copy. Both share one _id (Fix A.1), so filter
  // by id — whichever copy arrives first wins, and keys stay unique.
  const displayMessages = streamingMessage
    ? [streamingMessage, ...messages.filter((m) => String(m._id) !== String(streamingMessage._id))]
    : messages

  // Memoized from primitives: a fresh literal here would change the identity of
  // `handleSend` every render, re-rendering ChatInputBar's send button on every
  // keystroke (the composer's text state lives above it).
  const chatUser: ChatUser = useMemo(
    () => ({
      _id: currentUserId,
      name: userDisplayName || '',
      avatar: userPhotoUrl || undefined,
    }),
    [currentUserId, userDisplayName, userPhotoUrl],
  )

  const navigation = useNavigation()

  const handleEdit = useCallback(() => {
    router.push(`/characters/${characterId}/edit`)
  }, [characterId])

  const characterName = character.name || 'Character'

  // Phase 1 pipeline first, then the deprecated `characters.avatar` column as a
  // tail fallback for devices whose one-shot migration has not run and for
  // characters that predate `avatar_data` entirely — those legitimately have a
  // working legacy URL and no gallery row. `CharacterAvatar` supplies the
  // bundled default when both are null.
  const { uri: resolvedAvatar } = useResolvedImage(character.active_image_id, 'thumb')
  const characterAvatar = resolvedAvatar ?? character.avatar ?? null

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
              <CharacterAvatar size={40} imageUrl={characterAvatar} characterName={characterName} />
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
  }, [character, characterAvatar, characterName, handleEdit, navigation])

  const handleSend = useCallback(
    async (text: string) => {
      if (!creditsLoading && credits <= 0) {
        router.push('/subscribe')
        return
      }

      // Slice 3 owns the outgoing-message constructor: GiftedChat used to stamp
      // `_id`/`createdAt`/`user` before invoking `onSend`. With the lib gone,
      // ChatInputBar hands us text only, so we mint `_id` here. The `_id`
      // expression is the body of `messageIdGenerator` (now deleted) so the
      // shape of persisted rows does not change.
      const outgoingMessage: Message = {
        _id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
        text,
        createdAt: new Date(),
        user: chatUser,
      }
      await sendMessage(outgoingMessage)
    },
    [sendMessage, credits, creditsLoading, chatUser],
  )

  const handleSendPhoto = useCallback(
    async (photo: PendingChatPhoto, caption: string) => {
      if (!creditsLoading && credits <= 0) {
        router.push('/subscribe')
        return false
      }
      return await sendPhoto(photo, caption)
    },
    [sendPhoto, credits, creditsLoading],
  )

  const renderAvatar = useCallback(
    (message: Message) => {
      const isUser = message.user._id === currentUserId

      if (isUser) {
        const displayName = userDisplayName?.trim()
        const accessibilityLabel = displayName ? `${displayName}'s avatar` : 'Your avatar'
        const userAvatarUri = chatUser.avatar

        if (userAvatarUri) {
          return (
            <Avatar.Image
              accessible
              accessibilityRole="image"
              size={36}
              source={{ uri: userAvatarUri }}
              accessibilityLabel={accessibilityLabel}
            />
          )
        }
        return (
          <Avatar.Text
            accessible
            accessibilityRole="image"
            size={36}
            label={getInitials(displayName)}
            accessibilityLabel={accessibilityLabel}
          />
        )
      }

      return <CharacterAvatar size={36} imageUrl={characterAvatar} characterName={characterName} />
    },
    [currentUserId, userDisplayName, chatUser.avatar, characterAvatar, characterName],
  )

  return (
    <KeyboardAvoidingView
      ref={keyboardAvoidingRef}
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'translate-with-padding'}
      keyboardVerticalOffset={keyboardAvoidingOffset}
      onLayout={(event) => {
        keyboardAvoidingRelativeY.current = event.nativeEvent.layout.y
        remeasureKeyboardAvoidingOffset()
      }}
    >
      {(wikiStatus.ingesting ||
        wikiStatus.librarian ||
        isGeneratingResponse ||
        documentPhase !== null ||
        activeTool) && (
        <View
          accessibilityLiveRegion="polite"
          accessibilityRole={Platform.OS === 'web' ? ('status' as any) : undefined}
        >
          {documentPhase === 'reading' && (
            <Text style={styles.statusText} accessibilityLabel="Reading file">
              ⏳ Reading file…
            </Text>
          )}
          {documentPhase === 'converting' && (
            <Text style={styles.statusText} accessibilityLabel="Converting document">
              ⏳ Converting document…
            </Text>
          )}
          {documentPhase === 'checking' && (
            <Text style={styles.statusText} accessibilityLabel="Checking for changes">
              ⏳ Checking for changes…
            </Text>
          )}
          {documentPhase === 'forgetting' && (
            <Text style={styles.statusText} accessibilityLabel="Removing previous version">
              ⏳ Removing previous version…
            </Text>
          )}
          {wikiStatus.ingesting && (
            <Text style={styles.statusText} accessibilityLabel="Ingesting document">
              ⏳ Ingesting document…
            </Text>
          )}
          {wikiStatus.librarian && (
            <Text style={styles.statusText} accessibilityLabel="Updating memory">
              🧠 Updating memory…
            </Text>
          )}
          {escalationState === 'escalating' && (
            <Text style={styles.statusText} accessibilityLabel="Thinking deeply">
              🧠 Thinking deeply…
            </Text>
          )}
          {activeTool && (
            <Text
              style={styles.statusText}
              accessibilityLabel={toolStatusAccessibilityLabel(activeTool)}
            >
              {toolStatusLabel(activeTool)}
            </Text>
          )}
          {isGeneratingResponse &&
            escalationState !== 'escalating' &&
            !activeTool &&
            !streamingMessage?.text && (
              <Text style={styles.statusText} accessibilityLabel="Thinking">
                💭 Thinking…
              </Text>
            )}
        </View>
      )}
      {chatError && (
        // `sendPhoto` and the text mutation both record failures here and then
        // return normally, so this region is the only thing that tells the user
        // a turn failed. Assertive, not polite: it interrupts, because the
        // alternative is a photo that silently never got a reply.
        <View
          accessibilityLiveRegion="assertive"
          accessibilityRole={Platform.OS === 'web' ? ('alert' as any) : undefined}
        >
          <Text style={[styles.errorText, { color: colors.error }]} accessibilityLabel={chatError}>
            {chatError}
          </Text>
        </View>
      )}
      <LowPowerBanner />
      <MessageList
        messages={displayMessages}
        currentUserId={currentUserId}
        renderAvatar={renderAvatar}
        contentContainerStyle={styles.messagesContainer}
      />
      <ChatInputBar
        characterId={characterId}
        userId={currentUserId}
        onSubmit={handleSend}
        onSendPhoto={handleSendPhoto}
        onPhaseChange={setDocumentPhase}
        canSendPhoto={canSendPhoto}
        isGenerating={isGeneratingResponse}
      />
    </KeyboardAvoidingView>
  )
}

export default function ChatView({ characterId }: ChatViewProps) {
  const authService = useAuthMachine()
  const { user } = useSelector(authService, (state) => ({
    user: state.context.user,
  }))
  const currentUserId = user?.uid
  const { data: character, isLoading: characterLoading } = useCharacter(characterId)

  useEffect(() => {
    if (characterId) {
      setActiveCharacterId(characterId)
    }
  }, [characterId])

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
  errorText: {
    textAlign: 'center',
    paddingVertical: 4,
    paddingHorizontal: 12,
    fontSize: 12,
  },
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
})
