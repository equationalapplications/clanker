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
  onSend,
  text,
  textInputProps,
  characterId,
  userId,
  hasUnlimited,
  ...props
}: ChatComposerProps<TMessage>) {

  const actorRef = useRef<DocumentIngestMachineActor | undefined>(undefined)
  const subscriptionRef = useRef<{ unsubscribe: () => void } | undefined>(undefined)
  const progressResetTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [, setProgress] = useState(0)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  useEffect(() => {
    return () => {
      subscriptionRef.current?.unsubscribe()
      clearTimeout(progressResetTimerRef.current)
    }
  }, [])

  const handleDocumentIngest = useCallback(() => {
    if (!characterId || !userId) return

    // Cancel any pending progress reset before starting a new ingest
    clearTimeout(progressResetTimerRef.current)

    dispatchDocumentIngest(characterId, userId)
    const actor = getDocumentIngestMachineActor(characterId)
    if (!actor) return

    if (actorRef.current !== actor) {
      subscriptionRef.current?.unsubscribe()
      actorRef.current = actor

      subscriptionRef.current = actor.subscribe((state) => {
        setProgress(state.context.progress)
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
        } else if (state.matches('idle') && actorRef.current != null) {
          // Reset progress bar after returning to idle; store ID so it can be
          // cancelled if a new ingest starts within the animation window.
          progressResetTimerRef.current = setTimeout(() => setProgress(0), 400)
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
