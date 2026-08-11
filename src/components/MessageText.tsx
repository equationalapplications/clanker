import React from 'react'
import { Text, Linking, Platform } from 'react-native'
import { linkifyUrls } from '~/utils/linkifyUrls'
import { isSafeHttpUrl } from '~/utils/isSafeHttpUrl'

interface MessageTextProps {
  text: string
  color: string
}

export function MessageText({ text, color }: MessageTextProps) {
  const segments = linkifyUrls(text)
  return (
    <Text
      style={{
        color,
        ...(Platform.OS === 'web'
          ? ({ wordBreak: 'break-word', overflowWrap: 'anywhere' } as any)
          : {}),
      }}
    >
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          return <Text key={index}>{segment.value}</Text>
        }
        if (!isSafeHttpUrl(segment.value)) {
          return <Text key={index}>{segment.value}</Text>
        }
        return (
          <Text
            key={index}
            style={{ textDecorationLine: 'underline' }}
            onPress={() => {
              void Linking.openURL(segment.value).catch((error) => {
                console.warn('Failed to open URL', error)
              })
            }}
          >
            {segment.value}
          </Text>
        )
      })}
    </Text>
  )
}