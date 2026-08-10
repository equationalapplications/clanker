import { useCallback, useEffect, useRef, useState } from 'react'
import { View, StyleSheet, ActivityIndicator, Platform } from 'react-native'
import { Composer } from 'react-native-gifted-chat'
import type { ComposerProps, IMessage, SendProps } from 'react-native-gifted-chat'
import { Button, Dialog, IconButton, Portal, Snackbar, Text, useTheme } from 'react-native-paper'
import * as DocumentPicker from 'expo-document-picker'
import { File as ExpoFile } from 'expo-file-system'
import * as Crypto from 'expo-crypto'
import { WikiBusyError } from '@equationalapplications/expo-llm-wiki'
import { convertDocumentText } from '~/services/apiClient'
import { useCharacterWiki } from '~/hooks/useCharacterWiki'
import { useChatPhotoUpload, type PendingChatPhoto } from '~/hooks/useChatPhotoUpload'
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
    /** False when the character has no cloud agent — the photo option is disabled, never degraded. */
    canSendPhoto?: boolean
    /**
     * A chat turn is in flight. Kept separate from `canSendPhoto` because the
     * two disable for different reasons and the dialog explains each one;
     * folding them together would tell a cloud-synced user their character
     * cannot see photos.
     */
    isSending?: boolean
    onSendPhoto?: (photo: PendingChatPhoto, caption: string) => void
  }

async function readAsBase64(uri: string): Promise<string> {
  const file = new ExpoFile(uri)
  return file.base64()
}

// Vertical padding inside the text input. The Composer fixes the TextInput's
// height to composerHeight, so this padding must be added back to the height
// reported through onInputSizeChanged or the text gets clipped.
export const COMPOSER_VERTICAL_PADDING = 8
const LINE_HEIGHT = 22 // matches gifted-chat Composer's textInput lineHeight
// gifted-chat's Composer.js bakes its own marginTop/marginBottom onto the
// TextInput INSIDE the fixed `height: composerHeight` box (see
// node_modules/react-native-gifted-chat/lib/Composer.js styles.textInput).
// That margin eats into the usable text area on top of our own padding, so it
// must be added to the height or the bottom line of text gets clipped.
const COMPOSER_MARGIN_VERTICAL = Platform.select({ ios: 6 + 5, android: 0 + 3, default: 6 + 4 })
// ~2.5 lines visible when idle, grows up to ~6 before scrolling internally.
export const MIN_INPUT_HEIGHT =
  LINE_HEIGHT * 2.5 + COMPOSER_VERTICAL_PADDING * 2 + COMPOSER_MARGIN_VERTICAL
export const MAX_INPUT_HEIGHT =
  LINE_HEIGHT * 6 + COMPOSER_VERTICAL_PADDING * 2 + COMPOSER_MARGIN_VERTICAL

export default function ChatComposer<TMessage extends IMessage = IMessage>({
  onSend,
  text,
  textInputProps,
  characterId,
  userId,
  onPhaseChange,
  onInputSizeChanged,
  canSendPhoto = true,
  isSending = false,
  onSendPhoto,
  ...props
}: ChatComposerProps<TMessage>) {
  const { colors, roundness } = useTheme()
  const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [phase, setPhase] = useState<DocumentUploadPhase>(null)
  const [pendingImageAsset, setPendingImageAsset] = useState<
    { uri: string; width: number; height: number; asset: DocumentPicker.DocumentPickerAsset } | null
  >(null)
  const lastSeenPhotoErrorRef = useRef<string | null>(null)
  const activeRequestIdRef = useRef(0)

  const { prepareFromAsset, captureFromCamera, isPreparing, error: photoError, clearError: clearPhotoError } = useChatPhotoUpload()

  const characterWiki = useCharacterWiki(characterId ?? '')
  const { hasChanged, forget, ingest, isIngesting } = characterWiki

  useEffect(() => {
    return () => {
      activeRequestIdRef.current = -1
    }
  }, [])

  // Collapse the composer height back to its idle size once the user empties
  // the input. Done in an effect rather than the render body because the
  // render-body form schedules a state update during render, which React's
  // concurrent renderer does not support.
  useEffect(() => {
    if (!text && inputHeight !== MIN_INPUT_HEIGHT) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: collapse height when text empties
      setInputHeight(MIN_INPUT_HEIGHT)
    }
  }, [text, inputHeight])

  // Surface photo upload errors as a toast. The hook holds the error as a plain
  // string, so a second identical failure — a camera permission denied twice —
  // would leave `photoError` unchanged and fire no effect. Clearing the hook's
  // error after toasting makes every failure a transition, so the next one
  // toasts again. The ref still guards the render that re-reads the same string
  // before the clear lands.
  useEffect(() => {
    if (photoError === lastSeenPhotoErrorRef.current) return
    lastSeenPhotoErrorRef.current = photoError
    if (photoError) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: fire toast once per new photoError
      setToastMessage(photoError)
      clearPhotoError()
    }
  }, [photoError, clearPhotoError])

  const ingestDocument = useCallback(
    async (asset: DocumentPicker.DocumentPickerAsset) => {
      let requestId = 0
      const isStaleRequest = () => requestId !== 0 && activeRequestIdRef.current !== requestId

      try {
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
            fileContent = await readAsBase64(uri)
          } else {
            const file = new ExpoFile(uri)
            fileContent = await file.text()
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
              setToastMessage('Out of Power — recharge to keep chatting.')
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
            .replace(/^﻿/, '')
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
        if (activeRequestIdRef.current === -1 || isStaleRequest()) return
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
    },
    [hasChanged, forget, ingest, onPhaseChange],
  )

  const handlePlusPress = useCallback(async () => {
    if (!characterId || !userId) return

    const pickerResult = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      type: [...TEXT_MIME_TYPES, ...CONVERT_MIME_TYPES],
    })
    if (pickerResult.canceled || !pickerResult.assets?.[0]) return

    const asset = pickerResult.assets[0]
    const mimeType = resolveDocumentMimeType(asset.name ?? asset.uri, asset.mimeType)
      ?.trim()
      .toLowerCase()

    // Images have been accepted here since before Phase 2, and they went to the
    // wiki. A user who has been dropping screenshots in to build the character's
    // memory must not find those screenshots silently becoming chat messages, so
    // the branch is a question, not a redirect. Non-image picks are untouched.
    if (mimeType?.startsWith('image/')) {
      setPendingImageAsset({
        uri: asset.uri,
        width: (asset as { width?: number }).width ?? 0,
        height: (asset as { height?: number }).height ?? 0,
        asset,
      })
      return
    }

    await ingestDocument(asset)
  }, [characterId, userId, ingestDocument])

  const handleNativeSubmitEditing = useCallback(
    (event: { nativeEvent: { text: string } }) => {
      const value = event.nativeEvent?.text
      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (trimmed && onSend) {
          onSend({ text: trimmed } as Partial<TMessage>, true)
        }
      }
    },
    [onSend],
  )

  const showPlusButton = Boolean(characterId) && Boolean(userId)

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {showPlusButton && (
          (isIngesting || isPreparing || phase !== null) ? (
            <View
              style={styles.spinnerContainer}
              accessible
              accessibilityRole="progressbar"
              // Two operations share this slot: a photo being prepared for
              // chat (isPreparing), and a document being ingested into the
              // character's memory. Reading the wrong label confuses assistive
              // tech, so the label tracks the active operation.
              accessibilityLabel={isPreparing ? 'Preparing photo' : 'Adding document to memory'}
              accessibilityState={{ busy: true }}
            >
              <ActivityIndicator size={20} />
            </View>
          ) : (
            <View style={styles.attachmentRow}>
              <IconButton
                icon="plus"
                size={20}
                onPress={handlePlusPress}
                style={styles.plusButton}
                accessibilityLabel="Attach a photo or document"
                accessibilityHint="Opens the picker to send a photo in chat or add a document to this character's memory"
              />
              {canSendPhoto && (
                <IconButton
                  icon="camera"
                  size={20}
                  // The turn in flight owns the hook's streaming state; a second
                  // photo would race it. `useAIChat.sendPhoto` guards the taps
                  // that land before this disabled state renders.
                  disabled={isSending}
                  onPress={async () => {
                    // Capturing a photo in order to file it into memory is not a
                    // flow anyone asks for, so the camera goes straight to chat.
                    const photo = await captureFromCamera()
                    if (photo) {
                      onSendPhoto?.(photo, text ?? '')
                      // Reset the composer: the caption has been bundled with
                      // the photo and the user should not be able to send it
                      // again as a follow-up text turn. `handleSend` ignores
                      // empty-text messages, so this only clears the input.
                      onSend?.({ text: '' } as Partial<TMessage>, true)
                    }
                  }}
                  style={styles.plusButton}
                  accessibilityLabel="Take a photo"
                  accessibilityHint="Opens the camera and sends the photo in chat"
                />
              )}
            </View>
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
            composerHeight={inputHeight}
            onInputSizeChanged={(size) => {
              const height = Math.max(
                MIN_INPUT_HEIGHT,
                Math.min(
                  MAX_INPUT_HEIGHT,
                  size.height + COMPOSER_VERTICAL_PADDING * 2 + COMPOSER_MARGIN_VERTICAL,
                ),
              )
              setInputHeight(height)
              // Keep GiftedChat's internal composerHeight in sync so the message
              // list offset tracks the input's real size.
              onInputSizeChanged?.({ ...size, height })
            }}
            textInputStyle={{
              backgroundColor: 'transparent',
              paddingHorizontal: 12,
              paddingVertical: COMPOSER_VERTICAL_PADDING,
              textAlignVertical: 'center',
              color: colors.onSurfaceVariant,
            }}
            textInputProps={{
              ...textInputProps,
              accessibilityLabel: 'Message input',
              submitBehavior: 'submit',
              returnKeyType: 'send',
              onSubmitEditing: (event: any) => {
                textInputProps?.onSubmitEditing?.(event)
                handleNativeSubmitEditing(event)
              },
            }}
          />
        </View>
      </View>
      <Portal>
        <Dialog visible={pendingImageAsset !== null} onDismiss={() => setPendingImageAsset(null)}>
          <Dialog.Title>Add this image</Dialog.Title>
          {!canSendPhoto ? (
            <Dialog.Content>
              <Text>Only cloud-synced characters can see photos in chat.</Text>
            </Dialog.Content>
          ) : isSending ? (
            <Dialog.Content>
              <Text>Wait for the current reply to finish before sending a photo.</Text>
            </Dialog.Content>
          ) : null}
          <Dialog.Actions>
            <Button
              disabled={!canSendPhoto || isSending}
              onPress={async () => {
                const picked = pendingImageAsset
                setPendingImageAsset(null)
                if (!picked) return
                try {
                  const photo = await prepareFromAsset({
                    uri: picked.uri,
                    width: picked.width,
                    height: picked.height,
                  })
                  onSendPhoto?.(photo, text ?? '')
                  // See camera-button note: clear the caption so it cannot
                  // be re-sent as a text turn. `handleSend` ignores empties.
                  onSend?.({ text: '' } as Partial<TMessage>, true)
                } catch (err) {
                  setToastMessage(err instanceof Error ? err.message : 'Failed to prepare photo.')
                }
              }}
            >
              Send in chat
            </Button>
            <Button
              onPress={async () => {
                const picked = pendingImageAsset
                setPendingImageAsset(null)
                if (picked) await ingestDocument(picked.asset)
              }}
            >
              Add to memory
            </Button>
          </Dialog.Actions>
        </Dialog>
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
  attachmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  composerWrapper: {
    flex: 1,
    // Must be a row: gifted-chat's Composer puts flex: 1 on the TextInput, and
    // in a column container that flexes its HEIGHT to zero-basis, overriding
    // the explicit height: composerHeight and collapsing the input to one line.
    flexDirection: 'row',
    alignItems: 'flex-end',
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
