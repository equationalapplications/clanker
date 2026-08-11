import React from 'react'
import { FlatList, Platform, type FlatListProps } from 'react-native'
import { MessageRow } from '~/components/MessageRow'
import type { Message } from '~/types/chat'

interface MessageListProps {
  messages: Message[]
  currentUserId: string
  renderAvatar: (message: Message) => React.ReactNode
  emptyComponent?: React.ReactNode
  contentContainerStyle?: FlatListProps<Message>['contentContainerStyle']
}

const groundingListViewProps: Pick<FlatListProps<unknown>, 'removeClippedSubviews'> | undefined =
  Platform.OS === 'web' ? undefined : { removeClippedSubviews: false }

export function MessageList({
  messages,
  currentUserId,
  renderAvatar,
  emptyComponent,
  contentContainerStyle,
}: MessageListProps) {
  return (
    <FlatList
      inverted
      data={messages}
      keyExtractor={(m) => m._id}
      renderItem={({ item }) => (
        <MessageRow
          message={item}
          isOwn={item.user._id === currentUserId}
          renderAvatar={renderAvatar}
        />
      )}
      ListEmptyComponent={emptyComponent ?? null}
      contentContainerStyle={contentContainerStyle}
      removeClippedSubviews={groundingListViewProps?.removeClippedSubviews}
    />
  )
}
