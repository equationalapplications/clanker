import { useCallback } from 'react'
import { Composer, ComposerProps, IMessage, SendProps } from 'react-native-gifted-chat'

type ChatComposerProps<TMessage extends IMessage = IMessage> = ComposerProps &
    Pick<SendProps<TMessage>, 'onSend' | 'text'>

export default function ChatComposer<TMessage extends IMessage = IMessage>({
    onSend,
    text,
    textInputProps,
    ...props
}: ChatComposerProps<TMessage>) {
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
            textInputProps={{
                ...textInputProps,
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
    )
}
