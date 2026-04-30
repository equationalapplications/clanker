import { useCallback, useRef, useState, useEffect } from 'react'
import { ActivityIndicator, Alert, View, StyleSheet } from 'react-native'
import { Composer } from 'react-native-gifted-chat'
import type { ComposerProps, IMessage, SendProps } from 'react-native-gifted-chat'
import { IconButton, Snackbar, Portal } from 'react-native-paper'
import {
  dispatchDocumentIngest,
  getDocumentIngestMachineActor,
  type DocumentIngestMachineActor,
} from '~/machines/documentIngestMachine'

type ChatComposerProps<TMessage extends IMessage = IMessage> = ComposerProps &
  Pick<SendProps<TMessage>, 'onSend' | 'text'> & {
    characterId?: string
    userId?: string
    hasUnlimited?: boolean
  }

export default function ChatComposer<TMessage extends IMessage = IMessage>({
  onInputSizeChanged,
  onSend,
  onTextChanged,
  text,
  textInputProps,
  characterId,
  userId,
  hasUnlimited,
  ...props
}: ChatComposerProps<TMessage>) {
  const skipNextSubmitRef = useRef(false)

  const actorRef = useRef<DocumentIngestMachineActor | undefined>(undefined)
  const subscriptionRef = useRef<{ unsubscribe: () => void } | undefined>(undefined)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

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
        setIsProcessing(!state.matches('idle'))

        if (state.matches('success')) {
          const factCount = state.context.facts.length
          const filename = state.context.filename ?? 'document'
          setToastMessage(`Added ${factCount} ${factCount === 1 ? 'memory' : 'memories'} from ${filename}`)
        } else if (state.matches('error')) {
          setToastMessage(state.context.errorMessage ?? 'Failed to ingest document.')
        } else if (state.matches('confirmingDuplicate')) {
          const count = state.context.duplicateEntryCount
          const filename = state.context.filename ?? 'document'
          const targetActor = actor
          Alert.alert(
            'Document Already Added',
            `${count} ${count === 1 ? 'memory' : 'memories'} from "${filename}" already exist.`,
            [
              { text: 'Replace', onPress: () => targetActor.send({ type: 'REPLACE' }) },
              { text: 'Add Anyway', onPress: () => targetActor.send({ type: 'ADD' }) },
              { text: 'Cancel', style: 'cancel', onPress: () => targetActor.send({ type: 'CANCEL' }) },
            ],
          )
        }
      })
    }
  }, [characterId, userId])

  const handlePlusPress = useCallback(() => {
    handleDocumentIngest()
  }, [handleDocumentIngest])

  const sendCurrentText = useCallback(() => {
    const trimmedText = text?.trim()

    if (trimmedText && onSend) {
      onSend({ text: trimmedText } as Partial<TMessage>, true)
    }
  }, [onSend, text])

  // Show the + button for any premium user with an active character session,
  // regardless of whether the character is cloud-synced.
  const showPlusButton = hasUnlimited && Boolean(characterId) && Boolean(userId)

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {showPlusButton && (
          isProcessing ? (
            <View
              style={styles.spinnerContainer}
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel="Adding document to memory"
              accessibilityState={{ busy: true }}
            >
              <ActivityIndicator size={20} />
            </View>
          ) : (
            <IconButton
              icon="plus"
              size={20}
              onPress={handlePlusPress}
              style={styles.plusButton}
              accessibilityLabel="Add document to memory"
              accessibilityHint="Opens file picker to add a document to this character's memory"
            />
          )
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
  spinnerContainer: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  composerWrapper: {
    flex: 1,
  },
})
