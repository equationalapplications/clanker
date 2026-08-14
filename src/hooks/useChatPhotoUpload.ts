/**
 * Turns a picked or captured photo into everything the chat send path needs.
 *
 * Lives outside `ChatComposer` so that component does not grow a second large
 * async handler beside the wiki-ingestion one.
 *
 * Deliberately does NOT crop. `useAvatarUpload` squares its result because an
 * avatar fills a circle; a photo the user is asking a question about must reach
 * the model with the subject intact — a landscape centre-cropped to a square can
 * remove the very thing being asked about. Non-square gallery rows are already
 * safe: `CharacterAvatar` covers rather than letterboxes, so promoting a chat
 * photo to avatar crops at display time (reversible) instead of capture time.
 */

import { useCallback, useState } from 'react'
import { Image, Platform } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { prepareImageVariants, type ImageVariants } from '~/services/imageVariants'
import { generateSecureUuid } from '~/utilities/generateSecureUuid'
import {
  MAX_ATTACHMENT_BASE64_CHARS,
  isAttachmentMimeType,
} from '../../shared/cloudAgentAttachments'
import type { CloudAgentAttachment } from '~/services/cloudAgentService'

export interface PendingChatPhoto {
  /** Pre-minted so the message row can carry the render hint before the save. */
  imageId: string
  messageId: string
  uri: string
  width: number
  height: number
  /** Encoded once here; handed to `saveCharacterImage` so it does not re-encode. */
  variants: ImageVariants
  attachment: CloudAgentAttachment
}

interface UseChatPhotoUploadReturn {
  prepareFromAsset: (asset: {
    uri: string
    width: number
    height: number
  }) => Promise<PendingChatPhoto>
  pickFromLibrary: () => Promise<PendingChatPhoto | null>
  captureFromCamera: () => Promise<PendingChatPhoto | null>
  isPreparing: boolean
  error: string | null
  clearError: () => void
}

function newMessageId(): string {
  // Matches ChatView's messageIdGenerator so photo turns and text turns are
  // indistinguishable downstream.
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
}

/**
 * `Device.isDevice` behind a deferred require. A static top-level `expo-device`
 * import throws during module evaluation on dev clients built before the module
 * was added, and every chat screen imports this hook — so a static import took
 * down the whole chat tab. Returns null when the native module is unavailable.
 */
function detectPhysicalDevice(): boolean | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Device = require('expo-device') as typeof import('expo-device')
    return Device.isDevice
  } catch {
    return null
  }
}

/**
 * Read the pixel dimensions of a URI when the caller can't supply them.
 *
 * `expo-image-picker` returns width/height on its assets, but `expo-document-picker`
 * only does so when the source advertises them — many image MIME types come back
 * as 0/0. Without dimensions, `prepareImageVariants` skips the resize stage and
 * the master blows past `MAX_ATTACHMENT_BASE64_CHARS`. `Image.getSize` reads
 * just the header; the underlying file is never decoded.
 */
function getDimensions(
  uri: string,
  hint: { width?: number; height?: number },
): Promise<{ width: number; height: number }> {
  const hintedWidth = hint.width ?? 0
  const hintedHeight = hint.height ?? 0
  if (hintedWidth > 0 && hintedHeight > 0) {
    return Promise.resolve({ width: hintedWidth, height: hintedHeight })
  }
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    )
  })
}

export function useChatPhotoUpload(): UseChatPhotoUploadReturn {
  const [isPreparing, setIsPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearError = useCallback(() => setError(null), [])

  const prepareFromAsset = useCallback(
    async (asset: { uri: string; width: number; height: number }): Promise<PendingChatPhoto> => {
      setIsPreparing(true)
      try {
        let dimensions: { width: number; height: number }
        try {
          dimensions = await getDimensions(asset.uri, asset)
        } catch {
          throw new Error('Could not read that image. Try a different file.')
        }

        const variants = await prepareImageVariants({
          uri: asset.uri,
          width: dimensions.width,
          height: dimensions.height,
        })

        if (!isAttachmentMimeType(variants.master.mimeType)) {
          throw new Error('This image format cannot be sent in chat.')
        }
        // Fail here rather than after a wasted round-trip: the server rejects the
        // same bound, and a 400 mid-send costs the user their photo and their wait.
        if (variants.master.base64.length > MAX_ATTACHMENT_BASE64_CHARS) {
          throw new Error('That photo is too large to send.')
        }

        return {
          imageId: generateSecureUuid(),
          messageId: newMessageId(),
          uri: asset.uri,
          width: dimensions.width,
          height: dimensions.height,
          variants,
          attachment: { mimeType: variants.master.mimeType, data: variants.master.base64 },
        }
      } finally {
        setIsPreparing(false)
      }
    },
    [],
  )

  const fromPickerResult = useCallback(
    async (result: ImagePicker.ImagePickerResult): Promise<PendingChatPhoto | null> => {
      if (result.canceled) return null
      const [asset] = result.assets
      if (!asset) return null
      return await prepareFromAsset({ uri: asset.uri, width: asset.width, height: asset.height })
    },
    [prepareFromAsset],
  )

  const pickFromLibrary = useCallback(async (): Promise<PendingChatPhoto | null> => {
    setError(null)
    try {
      // Mirror the camera branch: expo-image-picker doesn't prompt for the
      // gallery on Android, and on iOS the PHPicker handles the prompt itself
      // but still records canAskAgain state when the user has muted it
      // permanently. Asking up front lets us distinguish a fresh denial
      // (transient message) from a permanent one (point to device settings).
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!permission.granted) {
        setError(
          permission.canAskAgain
            ? 'Photo library access denied'
            : 'Photo library access is blocked. Enable photos for this app in your device settings.',
        )
        return null
      }
      // No allowsEditing: the OS cropper would force a square (see the module doc).
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      })
      return await fromPickerResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Photo library access denied')
      return null
    }
  }, [fromPickerResult])

  const captureFromCamera = useCallback(async (): Promise<PendingChatPhoto | null> => {
    setError(null)
    try {
      // The iOS simulator has no camera: UIImagePickerController's .camera source
      // type is unavailable there, and expo-image-picker sets it without checking
      // isSourceTypeAvailable, which throws an uncatchable native exception and
      // crashes the app. Fail with a message instead. Detection returns null on
      // dev clients that predate expo-device; iOS then fails closed because the
      // simulator crash is uncatchable, while Android falls through (its picker
      // errors are catchable).
      if (Platform.OS === 'ios') {
        const isDevice = detectPhysicalDevice()
        if (isDevice !== true) {
          setError(
            isDevice === null
              ? 'Camera capture is not available in this build — rebuild the dev client to enable it.'
              : 'Camera capture requires a physical iOS device.',
          )
          return null
        }
      }
      // expo-image-picker never prompts on its own: launchCameraAsync rejects
      // with MissingCameraPermissionException unless permission is ALREADY
      // granted (ImagePickerModule.swift only checks, it does not request), so
      // ask explicitly first. canAskAgain distinguishes a fresh denial from a
      // permanent one the OS will never re-prompt for.
      const permission = await ImagePicker.requestCameraPermissionsAsync()
      if (!permission.granted) {
        setError(
          permission.canAskAgain
            ? 'Camera access denied'
            : 'Camera access is blocked. Enable the camera for this app in your device settings.',
        )
        return null
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 1 })
      return await fromPickerResult(result)
    } catch (err) {
      // Matches useAvatarUpload's handling of a denied photo library: the picker
      // call is the only thing wrapped, so a downstream encode failure does not
      // get mislabelled as a permission problem.
      const message =
        err instanceof Error && !/denied/i.test(err.message) ? err.message : 'Camera access denied'
      setError(message)
      return null
    }
  }, [fromPickerResult])

  return { prepareFromAsset, pickFromLibrary, captureFromCamera, isPreparing, error, clearError }
}
