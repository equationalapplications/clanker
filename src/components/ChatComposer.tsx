import { useCallback, useRef, useState, useEffect } from 'react'
import { Alert, View, StyleSheet } from 'react-native'
import { Composer } from 'react-native-gifted-chat'
import type { ComposerProps, IMessage, SendProps } from 'react-native-gifted-chat'
import { IconButton, Snackbar, Portal } from 'react-native-paper'
import { useCurrentPlan } from '~/hooks/useCurrentPlan'
import {
  dispatchDocumentIngest,
  getDocumentIngestMachineActor,
  type DocumentIngestMachineActor,
} from '~/machines/documentIngestMachine'
import IngestProgressBar from '~/components/composer/IngestProgressBar'

type ChatComposerProps<TMessage extends IMessage = IMessage> = ComposerProps &
  Pick<SendProps<TMessage>, 'onSend' | 'text'> & {
    characterId?: string
    userId?: string
  }

export default function ChatComposer<TMessage extends IMessage = IMessage>({
  onInputSizeChanged,
  onSend,
  onTextChanged,
  text,
  textInputProps,
  characterId,
  userId,
  ...props
}: ChatComposerProps<TMessage>) {
  const skipNextSubmitRef = useRef(false)
  const { isSubscriber } = useCurrentPlan()

  const actorRef = useRef<DocumentIngestMachineActor | undefined>(undefined)
  const subscriptionRef = useRef<{ unsubscribe: () => void } | undefined>(undefined)
  const [progress, setProgress] = useState(0)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      subscriptionRef.current?.unsubscribe()
    }
  }, [])

  const handleDocumentIngest = useCallback(() => {
    if (!characterId || !userId) return

    dispatchDocumentIngest(characterId, userId)
    const actor = getDocumentIngestMachineActor(characterId)
    if (!actor) return

    // Only re-subscribe if this is a different actor instance
    if (actorRef.current !== actor) {
      subscriptionRef.current?.unsubscribe()
      actorRef.current = actor

      subscriptionRef.current = actor.subscribe((state) => {
        setProgress(state.context.progress)

        if (state.matches('success')) {
          const factCount = state.context.facts.length
          const filename = state.context.filename ?? 'document'
          setToastMessage(`Added ${factCount} ${factCount === 1 ? 'memory' : 'memories'} from ${filename}`)
        } else if (state.matches('error')) {
          setToastMessage(state.context.errorMessage ?? 'Failed to ingest document.')
        } else if (state.matches('idle') && actorRef.current != null) {
          // Reset progress bar after returning to idle
          setTimeout(() => setProgress(0), 400)
        }
      })
    }
  }, [characterId, userId])

  const handlePlusPress = useCallback(() => {
    Alert.alert(
      'Add to Memory',
      'Document text is sent to our AI provider for processing. Only UTF-8 encoded files are supported.',
      [
        {
          text: 'Add document to memory',
          onPress: handleDocumentIngest,
        },
        {
          text: 'Cancel',
          style: 'cancel',
        },
      ],
    )
  }, [handleDocumentIngest])

  const sendCurrentText = useCallback(() => {
    const trimmedText = text?.trim()

    if (trimmedText && onSend) {
      onSend({ text: trimmedText } as Partial<TMessage>, true)
    }
  }, [onSend, text])

  const showPlusButton = isSubscriber && Boolean(characterId) && Boolean(userId)

  return (
    <View style={styles.container}>
      <IngestProgressBar progress={progress} />
      <View style={styles.row}>
        {showPlusButton && (
          <IconButton
            icon="plus"
            size={20}
            onPress={handlePlusPress}
            style={styles.plusButton}
            accessibilityLabel="Add document to memory"
            accessibilityHint="Opens a menu to add a document to this character's memory"
          />
        )}
        <View style={styles.composerWrapper}>
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
        </View>
      </View>
      <Portal>
        <Snackbar
          visible={toastMessage !== null}
          onDismiss={() => setToastMessage(null)}
          duration={3000}
        >
          {toastMessage ?? ''}
        </Snackbar>
      </Portal>
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
  plusButton: {
    margin: 0,
    marginBottom: 2,
  },
  composerWrapper: {
    flex: 1,
  },
})
