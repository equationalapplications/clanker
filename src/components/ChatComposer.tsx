import { useCallback, useRef } from 'react'
import { Composer } from 'react-native-gifted-chat'
import type { ComposerProps, IMessage, SendProps } from 'react-native-gifted-chat'

type ChatComposerProps<TMessage extends IMessage = IMessage> = ComposerProps &
  Pick<SendProps<TMessage>, 'onSend' | 'text'>

export default function ChatComposer<TMessage extends IMessage = IMessage>({
  onInputSizeChanged,
  onSend,
  onTextChanged,
  text,
  textInputProps,
  ...props
}: ChatComposerProps<TMessage>) {
  const skipNextSubmitRef = useRef(false)

  const sendCurrentText = useCallback(() => {
    const trimmedText = text?.trim()

    if (trimmedText && onSend) {
      onSend({ text: trimmedText } as Partial<TMessage>, true)
    }
  }, [onSend, text])

  return (
    <Composer
      {...props}
      text={text}
      onInputSizeChanged={onInputSizeChanged}
      onTextChanged={onTextChanged}
      textInputProps={{
        ...textInputProps,
        blurOnSubmit: false,
        returnKeyType: 'send',
        submitBehavior: 'submit',
        onKeyPress: (event) => {
          const nativeEvent = event.nativeEvent as typeof event.nativeEvent & { shiftKey?: boolean }

          textInputProps?.onKeyPress?.(event)

          if (nativeEvent.key !== 'Enter' || !nativeEvent.shiftKey) {
            return
          }

          skipNextSubmitRef.current = true
          onTextChanged?.(`${text ?? ''}\n`)

          setTimeout(() => {
            skipNextSubmitRef.current = false
          }, 0)
        },
        onSubmitEditing: (event) => {
          textInputProps?.onSubmitEditing?.(event)

          if (skipNextSubmitRef.current) {
            skipNextSubmitRef.current = false
            return
          }

          sendCurrentText()
        },
      }}
    />
  )
}
