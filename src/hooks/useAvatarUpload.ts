import { useState } from 'react'
import { Platform } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { manipulateAsync } from 'expo-image-manipulator'
import { useCharacterMachine } from '~/hooks/useMachines'
import { getCurrentUser } from '~/config/firebaseConfig'
import { saveCharacterImage } from '~/services/characterImageService'
import { getEncodeTarget } from '~/utilities/webpSupport'

interface UseAvatarUploadProps {
  characterId: string
  /** Receives the new `character_images` row id. */
  onImageUploaded?: (imageId: string) => void
}

interface UseAvatarUploadReturn {
  uploadAvatar: () => Promise<string | null>
  isUploading: boolean
  error: string | null
  clearError: () => void
}

const MIN_IMAGE_DIMENSION = 200

/**
 * Web has no native cropper (`allowsEditing` is a no-op there), so square it
 * ourselves by taking the largest centred square. Native returns an
 * already-square asset from the OS cropper and skips this entirely.
 */
async function centreCropToSquare(uri: string, width: number, height: number) {
  if (width === height) return { uri, width, height }

  const side = Math.min(width, height)
  const { format } = getEncodeTarget()
  const cropped = await manipulateAsync(
    uri,
    [
      {
        crop: {
          originX: Math.floor((width - side) / 2),
          originY: Math.floor((height - side) / 2),
          width: side,
          height: side,
        },
      },
    ],
    { format, compress: 1 },
  )
  return { uri: cropped.uri, width: cropped.width ?? side, height: cropped.height ?? side }
}

export function useAvatarUpload({
  characterId,
  onImageUploaded,
}: UseAvatarUploadProps): UseAvatarUploadReturn {
  const characterService = useCharacterMachine()
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearError = () => setError(null)

  const uploadAvatar = async (): Promise<string | null> => {
    setIsUploading(true)
    setError(null)

    try {
      const userId = getCurrentUser()?.uid
      if (!userId) throw new Error('You must be signed in to upload an image')

      // Wrap only the picker call so "Photo library access denied" is assigned
      // only when the picker or photo-library permission operation explicitly
      // reports denial — not for downstream upload or save errors whose message
      // happens to contain "permission".
      let pickerResult: ImagePicker.ImagePickerResult
      try {
        pickerResult = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          // The user picks their own crop, and the result is guaranteed square:
          // iOS always shows a square cropper when editing is on, and `aspect`
          // drives Android. Previously a 16:9 photo became 1024×576 and the
          // circular mask cropped an arbitrary slice nobody chose.
          allowsEditing: true,
          aspect: [1, 1],
          quality: 1,
        })
      } catch {
        setError('Photo library access denied')
        return null
      }

      if (pickerResult.canceled) return null

      const [asset] = pickerResult.assets
      if (!asset) throw new Error('No image selected')

      const { uri: sourceUri, width, height } = asset

      if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) {
        throw new Error('Image too small. Minimum size is 200×200 pixels.')
      }

      const square =
        Platform.OS === 'web'
          ? await centreCropToSquare(sourceUri, width, height)
          : { uri: sourceUri, width, height }

      const row = await saveCharacterImage({
        characterId,
        userId,
        uri: square.uri,
        width: square.width,
        height: square.height,
        source: 'uploaded',
      })

      characterService.send({ type: 'LOAD' })
      onImageUploaded?.(row.id)
      return row.id
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload image'
      setError(message)
      return null
    } finally {
      setIsUploading(false)
    }
  }

  return { uploadAvatar, isUploading, error, clearError }
}
