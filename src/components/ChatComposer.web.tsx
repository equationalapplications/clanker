import { useCallback } from 'react'
import { View, StyleSheet } from 'react-native'
import { Composer } from 'react-native-gifted-chat'
import type { ComposerProps, IMessage, SendProps } from 'react-native-gifted-chat'
import { useTheme } from 'react-native-paper'

type ChatComposerProps<TMessage extends IMessage = IMessage> = ComposerProps &
  Pick<SendProps<TMessage>, 'onSend' | 'text'> & {
    characterId?: string
    userId?: string
    hasUnlimited?: boolean
  }

export default function ChatComposer<TMessage extends IMessage = IMessage>({
  onSend,
  text,
  textInputProps,
  ...props
}: ChatComposerProps<TMessage>) {
  const { colors, roundness } = useTheme()

  const sendCurrentText = useCallback(() => {
    const trimmedText = text?.trim()

    if (trimmedText && onSend) {
      onSend({ text: trimmedText } as Partial<TMessage>, true)
    }
  }, [onSend, text])

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.composerWrapper}>
          <Composer
            {...props}
            text={text}
            textInputStyle={{
              backgroundColor: colors.surfaceVariant,
              borderRadius: roundness * 4,
              paddingHorizontal: 12,
              paddingTop: 10,
              paddingBottom: 10,
              color: colors.onSurfaceVariant,
              marginVertical: 4,
            }}
            textInputProps={{
              ...textInputProps,
              accessibilityLabel: 'Message input',
              onKeyPress: (event) => {
                const nativeEvent = event.nativeEvent as typeof event.nativeEvent & { shiftKey?: boolean }

                textInputProps?.onKeyPress?.(event)

                if (nativeEvent.key !== 'Enter' || nativeEvent.shiftKey) {
                  return
                }

                const webKeyEvent = event as { preventDefault?: () => void }
                webKeyEvent.preventDefault?.()
                sendCurrentText()
              },
            }}
          />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  composerWrapper: {
    flex: 1,
  },
})

