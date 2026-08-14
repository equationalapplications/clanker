import React, { useCallback, useEffect, useRef, useState } from 'react'
import { View, TextInput, StyleSheet, ActivityIndicator, Platform } from 'react-native'
import {
  Button,
  Dialog,
  IconButton,
  Menu,
  Portal,
  Snackbar,
  Text,
  useTheme,
} from 'react-native-paper'
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

// Vertical padding inside the text input. Both web and native resolve to the
// same value now — the split parent file is gone.
export const COMPOSER_VERTICAL_PADDING = 8
const LINE_HEIGHT = 22
// No extra vertical margin is needed: the previous values (6+5 iOS, 0+3
// Android, 6+4 default) compensated for `react-native-gifted-chat`'s
// internal TextInput marginTop/marginBottom, which the new TextInput does
// not have. Adding it here adds ~11px of empty space inside the composer
// on iOS and mis-aligns it next to the Send button.
export const MIN_INPUT_HEIGHT = LINE_HEIGHT * 2.5 + COMPOSER_VERTICAL_PADDING * 2
export const MAX_INPUT_HEIGHT = LINE_HEIGHT * 6 + COMPOSER_VERTICAL_PADDING * 2

export interface ChatComposerProps {
  text: string
  onChangeText: (text: string) => void
  onSubmit: () => void
  textInputProps?: Partial<React.ComponentProps<typeof TextInput>>
  // Owning-component props
  characterId: string
  userId: string
  onPhaseChange?: (phase: DocumentUploadPhase) => void
  canSendPhoto?: boolean
  isSending?: boolean
  // Returns true on success so the composer can clear the typed caption
  // only when the photo turn actually launched. On failure the caption
  // stays in the input — the chatError region surfaces the reason and the
  // user can retry without retyping.
  onSendPhoto?: (photo: PendingChatPhoto, caption: string) => Promise<boolean>
}

async function readAsBase64(uri: string): Promise<string> {
  const file = new ExpoFile(uri)
  return file.base64()
}

export default function ChatComposer({
  text,
  onChangeText,
  onSubmit,
  textInputProps,
  characterId,
  userId,
  onPhaseChange,
  canSendPhoto = true,
  isSending = false,
  onSendPhoto,
}: ChatComposerProps) {
  const { colors, roundness } = useTheme()
  const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [phase, setPhase] = useState<DocumentUploadPhase>(null)
  const [pendingImageAsset, setPendingImageAsset] = useState<{
    uri: string
    width: number
    height: number
    asset: DocumentPicker.DocumentPickerAsset
  } | null>(null)
  const [attachMenuVisible, setAttachMenuVisible] = useState(false)
  const lastSeenPhotoErrorRef = useRef<string | null>(null)
  const activeRequestIdRef = useRef(0)

  const {
    prepareFromAsset,
    captureFromCamera,
    pickFromLibrary,
    isPreparing,
    error: photoError,
    clearError: clearPhotoError,
  } = useChatPhotoUpload()
  const characterWiki = useCharacterWiki(characterId)
  const { hasChanged, forget, ingest, isIngesting } = characterWiki

  useEffect(() => {
    return () => {
      activeRequestIdRef.current = -1
    }
  }, [])

  // Collapse the composer height back to its idle size when the user empties
  // the input. The clamp is the sole authority on the idle height — no
  // measurement feedback loop, so web does not crash.
  useEffect(() => {
    if (!text && inputHeight !== MIN_INPUT_HEIGHT) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional collapse
      setInputHeight(MIN_INPUT_HEIGHT)
    }
  }, [text, inputHeight])

  useEffect(() => {
    if (photoError === lastSeenPhotoErrorRef.current) return
    lastSeenPhotoErrorRef.current = photoError
    if (photoError) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional toast
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
        const sourceRef =
          rawRef
            .replace(/[\x00-\x1f\x7f]/g, '')
            .slice(0, 200)
            .trim() || uri

        const resolvedMimeType = resolveDocumentMimeType(sourceRef, asset.mimeType)
        const normalizedMimeType = resolvedMimeType?.trim().toLowerCase()
        const isConvertType = Boolean(
          normalizedMimeType && CONVERT_MIME_TYPES.has(normalizedMimeType),
        )

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
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
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

  const handleDocumentPick = useCallback(async () => {
    // Close first, then invoke: the picker hands control to the OS, and the
    // menu must not linger while the app is backgrounded.
    setAttachMenuVisible(false)
    if (!characterId || !userId) return

    const pickerResult = await DocumentPicker.getDocumentAsync({
      // Copy into the app sandbox so expo-file-system can read the bytes
      // unconditionally. Without the copy, iCloud Drive / external URIs
      // fail at ExpoFile.text()/base64() because the path is outside the
      // sandbox.
      copyToCacheDirectory: true,
      type: [...TEXT_MIME_TYPES, ...CONVERT_MIME_TYPES],
    })
    if (pickerResult.canceled || !pickerResult.assets?.[0]) return

    const asset = pickerResult.assets[0]
    const mimeType = resolveDocumentMimeType(asset.name ?? asset.uri, asset.mimeType)
      ?.trim()
      .toLowerCase()

    // Same branch as before: a user who has been dropping screenshots in to
    // build the character's memory must not find those screenshots silently
    // becoming chat messages, so the question is asked. Non-image picks are
    // untouched.
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

  // Only clear the typed caption when the photo turn actually launched — if
  // sendPhoto rejects (network, credits, etc.) the user keeps their text and
  // can retry without retyping. Same send shape the old camera button used.
  const sendPhotoToChat = useCallback(
    async (photo: PendingChatPhoto) => {
      const sent = await onSendPhoto?.(photo, text)
      if (sent) onChangeText('')
    },
    [onSendPhoto, text, onChangeText],
  )

  const handleTakePhoto = useCallback(async () => {
    setAttachMenuVisible(false)
    const photo = await captureFromCamera()
    if (!photo) return
    await sendPhotoToChat(photo)
  }, [captureFromCamera, sendPhotoToChat])

  const handlePickFromLibrary = useCallback(async () => {
    setAttachMenuVisible(false)
    const photo = await pickFromLibrary()
    if (!photo) return
    await sendPhotoToChat(photo)
  }, [pickFromLibrary, sendPhotoToChat])

  const isWeb = Platform.OS === 'web'
  const showPlusButton = Boolean(characterId) && Boolean(userId)

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {showPlusButton &&
          (isIngesting || isPreparing || phase !== null ? (
            <View
              style={styles.spinnerContainer}
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={isPreparing ? 'Preparing photo' : 'Adding document to memory'}
              accessibilityState={{ busy: true }}
            >
              <ActivityIndicator size={20} />
            </View>
          ) : (
            <View style={styles.attachmentRow}>
              <Menu
                visible={attachMenuVisible}
                onDismiss={() => setAttachMenuVisible(false)}
                anchor={
                  <IconButton
                    icon="plus"
                    size={20}
                    onPress={() => setAttachMenuVisible(true)}
                    style={styles.plusButton}
                    accessibilityLabel="Attach a photo or document"
                    accessibilityHint="Opens the attachment menu to take a photo, choose one from the library, or add a document"
                  />
                }
              >
                {canSendPhoto && (
                  <>
                    <Menu.Item
                      leadingIcon="camera"
                      title="Take photo"
                      disabled={isSending}
                      onPress={handleTakePhoto}
                    />
                    <Menu.Item
                      leadingIcon="image"
                      title="Choose from library"
                      disabled={isSending}
                      onPress={handlePickFromLibrary}
                    />
                  </>
                )}
                <Menu.Item
                  leadingIcon="file-document-outline"
                  title="Add document"
                  onPress={handleDocumentPick}
                />
              </Menu>
            </View>
          ))}
        <View
          style={[
            styles.composerWrapper,
            {
              backgroundColor: colors.surfaceVariant,
              borderRadius: roundness * 4,
              marginVertical: 4,
              marginRight: 12,
              overflow: 'hidden',
            },
          ]}
        >
          <TextInput
            value={text}
            onChangeText={onChangeText}
            onContentSizeChange={(event) => {
              const contentHeight = event.nativeEvent.contentSize.height
              // react-native-web reports the multiline TextInput as a
              // <textarea>, where `contentSize.height` is the textarea's
              // own `scrollHeight` and already includes the textarea's
              // `paddingVertical`. Adding `+ 2*COMPOSER_VERTICAL_PADDING`
              // on web double-counts that padding, so every setState
              // produced a height strictly greater than the one we just
              // set; the collapse-on-empty effect then re-asserted
              // `MIN_INPUT_HEIGHT`, and the two fought until React tripped
              // the update-depth limit (error #185). Native TextInput
              // (iOS/Android) reports the content-box height without its
              // own padding, so the addition is correct there.
              const paddedContentHeight = isWeb
                ? contentHeight
                : contentHeight + COMPOSER_VERTICAL_PADDING * 2
              const height = Math.max(
                MIN_INPUT_HEIGHT,
                Math.min(MAX_INPUT_HEIGHT, paddedContentHeight),
              )
              if (height !== inputHeight) {
                setInputHeight(height)
              }
            }}
            onSubmitEditing={onSubmit}
            returnKeyType="send"
            submitBehavior="submit"
            // react-native-web 0.21.2 ignores `submitBehavior`, so plain
            // Enter inserts a newline on web instead of firing
            // `onSubmitEditing`. The native TextInput (Android 0.86.2)
            // honours `submitBehavior="submit"` so this branch never fires
            // there in practice; the platform check is defence-in-depth and
            // also keeps the handler's intent obvious in the tree. Shift+Enter
            // falls through and inserts a newline, matching the multiline
            // TextInput contract.
            onKeyPress={(event) => {
              if (!isWeb) return
              const { key, shiftKey } = event.nativeEvent as unknown as {
                key?: string
                shiftKey?: boolean
              }
              if (key === 'Enter' && !shiftKey) {
                onSubmit()
              }
            }}
            accessibilityLabel="Message input"
            placeholder="Message"
            placeholderTextColor={colors.onSurfaceVariant}
            multiline
            style={{
              // The underlying <textarea> on react-native-web 0.21.2 falls
              // back to `cols=20` (~150–200px) when the style omits an
              // explicit width — even inside a `flex: 1` parent, because
              // <textarea> is `display: inline-block` and shrinks to its
              // intrinsic size in a flex row. Pin it to the wrapper.
              width: '100%',
              height: inputHeight,
              backgroundColor: 'transparent',
              paddingHorizontal: 12,
              paddingVertical: COMPOSER_VERTICAL_PADDING,
              textAlignVertical: 'center',
              color: colors.onSurfaceVariant,
            }}
            {...textInputProps}
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
                  await sendPhotoToChat(photo)
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
