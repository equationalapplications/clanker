import { useCallback, useEffect, useRef, useState } from 'react'
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
  MAX_DOCUMENT_RAW_BYTES,
  resolveDocumentMimeType,
  TEXT_MIME_TYPES,
} from './documentMimeTypes'

export type DocumentUploadPhase = 'reading' | 'converting' | 'checking' | 'forgetting' | null

type ChatComposerProps<TMessage extends IMessage = IMessage> = ComposerProps &
  Pick<SendProps<TMessage>, 'onSend' | 'text'> & {
    characterId?: string
    userId?: string
    onPhaseChange?: (phase: DocumentUploadPhase) => void
  }

async function readAsBase64Web(uri: string): Promise<string> {
  const response = await fetch(uri)
  if (!response.ok) {
    throw new Error(`Failed to read file (HTTP ${response.status})`)
  }
  const blob = await response.blob()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : null
      const base64 = dataUrl?.split(',')[1]
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
  onPhaseChange,
  ...props
}: ChatComposerProps<TMessage>) {
  const { colors, roundness } = useTheme()
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [phase, setPhase] = useState<DocumentUploadPhase>(null)
  const activeRequestIdRef = useRef(0)

  const characterWiki = useCharacterWiki(characterId ?? '')
  const { hasChanged, forget, ingest, isIngesting } = characterWiki

  useEffect(() => {
    return () => {
      activeRequestIdRef.current = -1
    }
  }, [])

  const handlePlusPress = useCallback(async () => {
    if (!characterId || !userId) return

    let requestId = 0
    const isStaleRequest = () => requestId !== 0 && activeRequestIdRef.current !== requestId

    try {
      const pickerResult = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: false,
        type: [...TEXT_MIME_TYPES, ...CONVERT_MIME_TYPES],
      })
      if (pickerResult.canceled || !pickerResult.assets?.[0]) return

      const asset = pickerResult.assets[0]
      if (typeof asset.size === 'number' && asset.size > MAX_DOCUMENT_RAW_BYTES) {
        setToastMessage('File too large.')
        return
      }
      if (activeRequestIdRef.current === -1) return
      requestId = ++activeRequestIdRef.current

      setPhase('reading')
      onPhaseChange?.('reading')

      const uri = asset.uri
      const rawRef = asset.name ?? uri
      const sourceRef = rawRef.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200).trim() || uri

      const resolvedMimeType = resolveDocumentMimeType(sourceRef, asset.mimeType)
      const normalizedMimeType = resolvedMimeType?.trim().toLowerCase()
      const isConvertType = Boolean(normalizedMimeType && CONVERT_MIME_TYPES.has(normalizedMimeType))

      let fileContent: string
      try {
        if (isConvertType) {
          fileContent = await readAsBase64Web(uri)
        } else {
          const response = await fetch(uri)
          if (!response.ok) {
            throw new Error(`Failed to read file (HTTP ${response.status})`)
          }
          fileContent = await response.text()
        }
      } catch {
        if (isStaleRequest()) return
        setToastMessage('Failed to read file.')
        setPhase(null)
        onPhaseChange?.(null)
        return
      }
      if (isStaleRequest()) return

      let rawText: string
      if (isConvertType && normalizedMimeType) {
        setPhase('converting')
        onPhaseChange?.('converting')
        try {
          const convertResult = await convertDocumentText({
            filename: sourceRef,
            mimeType: normalizedMimeType,
            contentBase64: fileContent,
          })
          rawText = convertResult.data.text
        } catch (error) {
          if (isStaleRequest()) return
          const firebaseCode = (error as { code?: unknown } | null)?.code
          const message = (error as { message?: unknown } | null)?.message
          if (
            firebaseCode === 'functions/failed-precondition' &&
            typeof message === 'string' &&
            message.toLowerCase().includes('insufficient credits')
          ) {
            setToastMessage('Insufficient credits to convert this document.')
          } else if (firebaseCode === 'functions/invalid-argument') {
            setToastMessage('File too large or unsupported format.')
          } else {
            setToastMessage('Failed to convert document.')
          }
          setPhase(null)
          onPhaseChange?.(null)
          return
        }
        if (isStaleRequest()) return
      } else {
        rawText = fileContent
      }

      setPhase('checking')
      onPhaseChange?.('checking')

      let documentChunk: string
      let sourceHash: string
      let changed: boolean
      try {
        documentChunk = rawText
          .replace(/^\uFEFF/, '')
          .replace(/\0/g, '')
          .normalize('NFC')
          .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        sourceHash = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          documentChunk,
        )
        changed = await hasChanged(sourceRef, sourceHash)
      } catch {
        if (isStaleRequest()) return
        setToastMessage('Failed to check for changes.')
        setPhase(null)
        onPhaseChange?.(null)
        return
      }
      if (isStaleRequest()) return

      if (!changed) {
        setToastMessage(`"${sourceRef}" is already up to date.`)
        setPhase(null)
        onPhaseChange?.(null)
        return
      }

      setPhase('forgetting')
      onPhaseChange?.('forgetting')
      try {
        await forget({ sourceRef })
      } catch {
        if (isStaleRequest()) return
        setToastMessage('Failed to remove previous version.')
        setPhase(null)
        onPhaseChange?.(null)
        return
      }
      if (isStaleRequest()) return

      setPhase(null)
      onPhaseChange?.(null)

      const ingestResult = await ingest({
        sourceRef,
        sourceHash,
        documentChunk,
        promptOverride: ingestPromptOverride,
      })
      if (isStaleRequest()) return
      setToastMessage(
        `Document ingested (${ingestResult.chunks} chunk${ingestResult.chunks === 1 ? '' : 's'})`,
      )
    } catch (error) {
      if (isStaleRequest()) return
      setPhase(null)
      onPhaseChange?.(null)
      if (error instanceof WikiBusyError) {
        setToastMessage('Memory is busy. Please try again shortly.')
      } else if (
        error instanceof SyntaxError ||
        (error instanceof Error && error.message.includes('No JSON object/array found'))
      ) {
        setToastMessage('Failed to ingest document: AI response could not be parsed.')
      } else {
        setToastMessage('Failed to ingest document.')
      }
    }
  }, [characterId, userId, hasChanged, forget, ingest, onPhaseChange])

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
          (isIngesting || phase !== null) ? (
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

