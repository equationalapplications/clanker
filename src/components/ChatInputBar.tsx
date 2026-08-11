import React, { useState, useCallback } from 'react'
import { View, StyleSheet } from 'react-native'
import { useTheme } from 'react-native-paper'
import ChatComposer, { type DocumentUploadPhase } from '~/components/ChatComposer'
import { SendButton } from '~/components/SendButton'
import type { PendingChatPhoto } from '~/hooks/useChatPhotoUpload'

interface ChatInputBarProps {
  characterId: string
  userId: string
  onSubmit: (text: string) => void
  onSendPhoto: (photo: PendingChatPhoto, caption: string) => void
  onPhaseChange?: (phase: DocumentUploadPhase) => void
  canSendPhoto?: boolean
  isGenerating: boolean
  /** Slice 2 shim — one-way only. Sunset in Slice 3. */
  onHeightChange?: (height: number) => void
}

export function ChatInputBar({
  characterId,
  userId,
  onSubmit,
  onSendPhoto,
  onPhaseChange,
  canSendPhoto = true,
  isGenerating,
  onHeightChange,
}: ChatInputBarProps) {
  const { colors } = useTheme()
  const [text, setText] = useState('')

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSubmit(trimmed)
    setText('')
  }, [text, onSubmit])

  const handleChangeText = useCallback(
    (next: string) => {
      setText(next)
    },
    [],
  )

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderTopColor: colors.outlineVariant,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View style={styles.row}>
        <ChatComposer
          text={text}
          onChangeText={handleChangeText}
          onSubmit={handleSubmit}
          onHeightChange={onHeightChange}
          characterId={characterId}
          userId={userId}
          onPhaseChange={onPhaseChange}
          canSendPhoto={canSendPhoto}
          isSending={isGenerating}
          onSendPhoto={onSendPhoto}
        />
        <SendButton
          onPress={handleSubmit}
          disabled={text.trim().length === 0}
          isGenerating={isGenerating}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
})