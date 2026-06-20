import { useCallback, useState } from 'react'
import { View, StyleSheet, ActivityIndicator } from 'react-native'
import { Composer } from 'react-native-gifted-chat'
import type { ComposerProps, IMessage, SendProps } from 'react-native-gifted-chat'
import { IconButton, Portal, Snackbar, useTheme } from 'react-native-paper'
import * as DocumentPicker from 'expo-document-picker'
import * as Crypto from 'expo-crypto'
import { WikiBusyError } from '@equationalapplications/expo-llm-wiki'
import { convertDocumentText } from '~/services/apiClient'
import { useCharacterWiki } from '~/hooks/useCharacterWiki'
import { ingestPromptOverride } from './ingestPromptOverride'
import {
  CONVERT_MIME_TYPES,
  resolveDocumentMimeType,
  TEXT_MIME_TYPES,
} from './documentMimeTypes'

type ChatComposerProps<TMessage extends IMessage = IMessage> = ComposerProps &
  Pick<SendProps<TMessage>, 'onSend' | 'text'> & {
    characterId?: string
    userId?: string
  }

async function readAsBase64Web(uri: string): Promise<string> {
  const response = await fetch(uri)
  if (!response.ok) {
    throw new Error(`Failed to read file (HTTP ${response.status})`)
  }
  const blob = await response.blob()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.split(',')[1]
      if (!base64) {
        reject(new Error('Failed to extract base64 from file data'))
        return
      }
      resolve(base64)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(blob)
  })
}

export default function ChatComposer<TMessage extends IMessage = IMessage>({
  onSend,
  text,
  textInputProps,
  characterId,
  userId,
  ...props
}: ChatComposerProps<TMessage>) {
  const { colors, roundness } = useTheme()
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const characterWiki = useCharacterWiki(characterId ?? '')
  const { hasChanged, forget, ingest, isIngesting } = characterWiki

  const handlePlusPress = useCallback(async () => {
    if (!characterId || !userId) return

    try {
      const pickerResult = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: false,
        type: [...TEXT_MIME_TYPES, ...CONVERT_MIME_TYPES],
      })
      if (pickerResult.canceled || !pickerResult.assets?.[0]) return

      const asset = pickerResult.assets[0]
      const uri = asset.uri
      const rawRef = asset.name ?? uri
      const sourceRef = rawRef.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200).trim() || uri

      const resolvedMimeType = resolveDocumentMimeType(sourceRef, asset.mimeType)

      let rawText: string
      if (resolvedMimeType && CONVERT_MIME_TYPES.has(resolvedMimeType)) {
        const contentBase64 = await readAsBase64Web(uri)
        const convertResult = await convertDocumentText({
          filename: sourceRef,
          mimeType: resolvedMimeType,
          contentBase64,
        })
        rawText = convertResult.data.text
      } else {
        const response = await fetch(uri)
        if (!response.ok) {
          throw new Error(`Failed to read file (HTTP ${response.status})`)
        }
        rawText = await response.text()
      }

      const documentChunk = rawText
        .replace(/^\uFEFF/, '')
        .replace(/\0/g, '')
        .normalize('NFC')
        .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      const sourceHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        documentChunk,
      )

      const changed = await hasChanged(sourceRef, sourceHash)
      if (!changed) {
        setToastMessage(`"${sourceRef}" is already up to date.`)
        return
      }

      await forget({ sourceRef })

      const ingestResult = await ingest({
        sourceRef,
        sourceHash,
        documentChunk,
        promptOverride: ingestPromptOverride,
      })
      setToastMessage(
        `Document ingested (${ingestResult.chunks} chunk${ingestResult.chunks === 1 ? '' : 's'})`,
      )
    } catch (error) {
      const firebaseCode = (error as { code?: unknown } | null)?.code
      if (error instanceof WikiBusyError) {
        setToastMessage('Memory is busy. Please try again shortly.')
      } else if (firebaseCode === 'functions/failed-precondition') {
        setToastMessage('Insufficient credits to convert this document.')
      } else if (firebaseCode === 'functions/invalid-argument') {
        setToastMessage('File too large or unsupported format.')
      } else if (
        error instanceof SyntaxError ||
        (error instanceof Error && error.message.includes('No JSON object/array found'))
      ) {
        setToastMessage('Failed to ingest document: AI response could not be parsed.')
      } else {
        setToastMessage('Failed to ingest document.')
      }
    }
  }, [characterId, userId, hasChanged, forget, ingest])

  const sendCurrentText = useCallback(() => {
    const trimmedText = text?.trim()

    if (trimmedText && onSend) {
      onSend({ text: trimmedText } as Partial<TMessage>, true)
    }
  }, [onSend, text])

  const showPlusButton = Boolean(characterId) && Boolean(userId)

  const mergedTextInputProps = {
    ...textInputProps,
    style: [
      textInputProps?.style,
      {
        backgroundColor: 'transparent',
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: colors.onSurfaceVariant,
        outline: 'none',
        outlineColor: 'transparent',
        outlineWidth: 0,
        outlineOffset: 0,
        boxShadow: 'none',
        borderWidth: 0,
        borderColor: 'transparent',
      },
    ],
  }

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
        <View style={[styles.composerWrapper, {
          backgroundColor: colors.surfaceVariant,
          borderRadius: roundness * 4,
          marginVertical: 4,
          marginRight: 12,
          overflow: 'hidden',
        }]}>
          <Composer
            {...props}
            text={text}
            textInputStyle={{
              backgroundColor: 'transparent',
              paddingHorizontal: 12,
              paddingVertical: 10,
              color: colors.onSurfaceVariant,
            }}
            textInputProps={{
              ...mergedTextInputProps,
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
      <Portal>
        <Snackbar
          visible={toastMessage !== null}
          onDismiss={() => setToastMessage(null)}
          duration={3000}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          accessibilityLabel={toastMessage ?? ''}
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
  composerWrapper: {
    flex: 1,
  },
  spinnerContainer: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  plusButton: {
    margin: 0,
    marginBottom: 4,
  },
})

