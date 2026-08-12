import React from 'react'
import { View, Platform, StyleSheet } from 'react-native'
import { MessageBubble } from '~/components/MessageBubble'
import type { Message } from '~/types/chat'

interface MessageRowProps {
  message: Message
  isOwn: boolean
  renderAvatar: (message: Message) => React.ReactNode
}

export function MessageRow({ message, isOwn, renderAvatar }: MessageRowProps) {
  return (
    <View style={[styles.row, Platform.OS === 'web' ? { minWidth: 0, maxWidth: '100%' } : {}]}>
      {renderAvatar(message)}
      <View style={[styles.content, isOwn ? styles.right : styles.left]}>
        <MessageBubble message={message} isOwn={isOwn} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    marginVertical: 2,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
  },
  left: {
    justifyContent: 'flex-start',
  },
  right: {
    justifyContent: 'flex-end',
  },
})
