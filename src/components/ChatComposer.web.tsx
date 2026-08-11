import { useCallback, useEffect, useRef, useState } from 'react'
import { View, StyleSheet, ActivityIndicator } from 'react-native'
import { Composer } from 'react-native-gifted-chat'
import type { ComposerProps, IMessage, SendProps } from 'react-native-gifted-chat'
import { Button, Dialog, IconButton, Portal, Snackbar, Text, useTheme } from 'react-native-paper'
import * as DocumentPicker from 'expo-document-picker'
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

const LINE_HEIGHT = 22
const COMPOSER_MARGIN_VERTICAL = 6 + 4
// Web input's actual vertical padding — keep this exported so ChatView's Metro-resolved
// import gets the correct platform-specific value.
export const COMPOSER_VERTICAL_PADDING = 10
export const MIN_INPUT_HEIGHT =
  LINE_HEIGHT * 2.5 + COMPOSER_VERTICAL_PADDING * 2 + COMPOSER_MARGIN_VERTICAL
export const MAX_INPUT_HEIGHT =
  LINE_HEIGHT * 6 + COMPOSER_VERTICAL_PADDING * 2 + COMPOSER_MARGIN_VERTICAL

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

  const { prepareFromAsset, isPreparing, error: photoError, clearError: clearPhotoError } = useChatPhotoUpload()

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
      copyToCacheDirectory: false,
      type: [...TEXT_MIME_TYPES, ...CONVERT_MIME_TYPES],
    })
    if (pickerResult.canceled || !pickerResult.assets?.[0]) return

    const asset = pickerResult.assets[0]
    const mimeType = resolveDocumentMimeType(asset.name ?? asset.uri, asset.mimeType)
      ?.trim()
      .toLowerCase()

    // Same branch as on native: a user who has been dropping screenshots in to
    // build the character's memory must not find those screenshots silently
    // becoming chat messages, so the question is asked. Non-image picks are
    // untouched. Camera button is omitted on web — there is no useful web
    // behaviour for launchCameraAsync, and the file picker already covers it.
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

  const sendCurrentText = useCallback(() => {
    const trimmedText = text?.trim()

    if (trimmedText && onSend) {
      onSend({ text: trimmedText } as Partial<TMessage>, true)
    }
  }, [onSend, text])

  const showPlusButton = Boolean(characterId) && Boolean(userId)

  // NOTE: no `style` in here — gifted-chat's Composer spreads textInputProps
  // last on the TextInput, so a style here would replace the internal style
  // array including the `height: composerHeight` entry that drives growth.
  const mergedTextInputProps = {
    ...textInputProps,
  }

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
              // Ignore measurements while the input is empty. gifted-chat's Composer
              // only re-fires this callback when the browser reports a *different*
              // contentSize than last time — it has no debounce against feedback we
              // cause ourselves. Setting composerHeight from a measurement, while the
              // collapse-effect below forces it back to MIN_INPUT_HEIGHT on every
              // change (because text is empty), makes each state update trigger the
              // next contentSize re-measurement in the opposite direction — an
              // infinite render loop (React error #185 / "Maximum update depth
              // exceeded") on every empty-composer mount. The collapse effect is the
              // sole authority for the idle height; this handler only grows the box
              // once there's text to grow it for.
              if (!text) return

              // react-native-web reports scrollHeight, which already includes
              // the input's own padding — only the outer margins are missing.
              const height = Math.max(
                MIN_INPUT_HEIGHT,
                Math.min(MAX_INPUT_HEIGHT, size.height + COMPOSER_MARGIN_VERTICAL),
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
              color: colors.onSurfaceVariant,
              outline: 'none',
              outlineColor: 'transparent',
              outlineWidth: 0,
              outlineOffset: 0,
              boxShadow: 'none',
              borderWidth: 0,
              borderColor: 'transparent',
            } as any}
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
                  // See ChatComposer.tsx: clear the caption so it cannot be
                  // re-sent as a text turn. `handleSend` ignores empties.
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
    // the explicit height: composerHeight and collapsing the input.
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
