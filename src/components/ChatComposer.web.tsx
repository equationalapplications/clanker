import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, View, StyleSheet } from 'react-native'
import { Composer } from 'react-native-gifted-chat'
import type { ComposerProps, IMessage, SendProps } from 'react-native-gifted-chat'
import { IconButton, Snackbar, Portal } from 'react-native-paper'
import * as DocumentPicker from 'expo-document-picker'
import * as Crypto from 'expo-crypto'
import { useWikiIngest, useWikiHasChanged } from '@equationalapplications/expo-llm-wiki/react'
import { WikiBusyError } from '@equationalapplications/expo-llm-wiki'

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
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const { execute: ingestDocument, isPending: isIngesting } = useWikiIngest()
  const { execute: hasChanged } = useWikiHasChanged()

  const handlePlusPress = useCallback(async () => {
    if (!characterId || !userId) return

    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      type: ['text/plain', 'text/markdown'],
    })
    if (result.canceled || !result.assets?.[0]) return

    const asset = result.assets[0]
    const uri = asset.uri
    // Sanitize filename: strip control chars, cap length for stable sourceRef
    const rawRef = asset.name ?? uri
    const sourceRef = rawRef.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200).trim() || uri

    try {
      // expo-file-system doesn't support blob/object URLs on web; use fetch instead.
      // Normalize line-endings for consistent cross-platform hashing.
      const raw = await fetch(uri).then((r) => r.text())
      const documentChunk = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      const sourceHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        documentChunk,
      )

      const changed = await hasChanged(characterId, sourceRef, sourceHash)
      if (!changed) {
        const proceed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            'Document Already Added',
            `"${sourceRef}" has already been ingested. Add it again?`,
            [
              { text: 'Add Anyway', onPress: () => resolve(true) },
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            ],
          )
        })
        if (!proceed) return
      }

      const ingestResult = await ingestDocument(characterId, {
        sourceRef,
        sourceHash,
        documentChunk,
      })
      setToastMessage(
        `Document ingested (${ingestResult.chunks} chunk${ingestResult.chunks === 1 ? '' : 's'})`,
      )
    } catch (error) {
      if (error instanceof WikiBusyError) {
        setToastMessage('Memory is busy. Please try again shortly.')
      } else {
        setToastMessage('Failed to ingest document.')
      }
    }
  }, [characterId, userId, ingestDocument, hasChanged])

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
          isIngesting ? (
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

