import React from 'react'
import { View, Platform, StyleSheet } from 'react-native'
import { useTheme } from 'react-native-paper'
import { MessageText } from '~/components/MessageText'
import { GroundingFooter } from '~/components/GroundingFooter'
import ChatImageBubble from '~/components/ChatImageBubble'
import type { Message } from '~/types/chat'

interface MessageBubbleProps {
  message: Message
  isOwn: boolean
}

export function MessageBubble({ message, isOwn }: MessageBubbleProps) {
  const { colors, roundness } = useTheme()
  const webConstraints =
    Platform.OS === 'web' ? ({ maxWidth: '80%', minWidth: 0, overflow: 'hidden' } as const) : {}

  const bubbleStyle = [
    styles.bubble,
    webConstraints,
    {
      backgroundColor: isOwn ? colors.primary : colors.secondary,
      borderRadius: roundness,
    },
  ]

  const textColor = isOwn ? colors.onPrimary : colors.onSecondary

  return (
    <View style={bubbleStyle}>
      <View
        style={{
          paddingVertical: 10,
          ...(Platform.OS === 'web' ? { minWidth: 0, maxWidth: '100%' } : {}),
        }}
      >
        <MessageText text={message.text} color={textColor} />
      </View>
      {message.imageId && <ChatImageBubble currentMessage={message} />}
      {message.groundingMetadata && <GroundingFooter metadata={message.groundingMetadata} />}
    </View>
  )
}

const styles = StyleSheet.create({
  bubble: {
    // Horizontal padding only — the text wrapper adds the vertical inset, so
    // doubling it here would shrink the visible bubble area by ~4px per row.
    paddingHorizontal: 12,
  },
})
