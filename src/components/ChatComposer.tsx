import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, View, StyleSheet } from 'react-native'
import { Composer } from 'react-native-gifted-chat'
import type { ComposerProps, IMessage, SendProps } from 'react-native-gifted-chat'
import { IconButton, Snackbar, Portal, useTheme } from 'react-native-paper'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
import * as Crypto from 'expo-crypto'
import { useWikiIngest, useWikiHasChanged, useWikiForget, WikiBusyError } from '@equationalapplications/expo-llm-wiki'

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
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const { colors, roundness } = useTheme()

  const { execute: ingestDocument, isPending: isIngesting } = useWikiIngest()
  const { execute: hasChanged } = useWikiHasChanged()
  const { execute: forgetBySource } = useWikiForget()

  const handlePlusPress = useCallback(async () => {
    if (!characterId || !userId) return

    try {
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

      // Read as UTF-8 (the default); strip BOM/null bytes and normalize to NFC for
      // consistent cross-platform hashing regardless of editor/OS encoding quirks.
      const raw = await FileSystem.readAsStringAsync(uri)
      const documentChunk = raw
        .replace(/^\uFEFF/, '')   // strip UTF-8 BOM
        .replace(/\0/g, '')       // strip null bytes
        .normalize('NFC')         // canonical Unicode form
        .replace(/\r\n/g, '\n').replace(/\r/g, '\n')  // normalize line endings
      const sourceHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        documentChunk,
      )

      const changed = await hasChanged(characterId, sourceRef, sourceHash)
      if (!changed) {
        setToastMessage(`"${sourceRef}" is already up to date.`)
        return
      }

      // Remove stale facts from a previous version of this document before re-ingesting.
      await forgetBySource(characterId, { sourceRef })

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
  }, [characterId, userId, ingestDocument, hasChanged, forgetBySource])

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
            onInputSizeChanged={onInputSizeChanged}
            onTextChanged={onTextChanged}
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
          accessibilityLiveRegion="polite"
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
