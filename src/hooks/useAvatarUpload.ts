import { useState } from 'react'
import * as FileSystem from 'expo-file-system/legacy'
import * as ImagePicker from 'expo-image-picker'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { saveCharacterImageLocally } from '~/services/localImageStorageService'

interface UseAvatarUploadProps {
  characterId: string
  onImageUploaded?: (dataUri: string) => void
}

interface UseAvatarUploadReturn {
  uploadAvatar: () => Promise<string | null>
  isUploading: boolean
  error: string | null
  clearError: () => void
}

const MIN_IMAGE_DIMENSION = 200
const MAX_IMAGE_DIMENSION = 1024

export function useAvatarUpload({
  characterId,
  onImageUploaded,
}: UseAvatarUploadProps): UseAvatarUploadReturn {
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearError = () => setError(null)

  const uploadAvatar = async (): Promise<string | null> => {
    setIsUploading(true)
    setError(null)

    try {
      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      })

      if (pickerResult.canceled) {
        return null
      }

      const [asset] = pickerResult.assets
      if (!asset) {
        throw new Error('No image selected')
      }

      const { uri: sourceUri, width, height } = asset

      if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) {
        throw new Error('Image too small. Minimum size is 200×200 pixels.')
      }

      const actions =
        width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION
          ? [{ resize: width >= height ? { width: MAX_IMAGE_DIMENSION } : { height: MAX_IMAGE_DIMENSION } }]
          : []

      const manipulated = await manipulateAsync(sourceUri, actions, {
        format: SaveFormat.WEBP,
        compress: 0.9,
      })

      const base64 = await FileSystem.readAsStringAsync(manipulated.uri, {
        encoding: FileSystem.EncodingType.Base64,
      })

      const dataUri = await saveCharacterImageLocally(characterId, base64, 'image/webp')
      onImageUploaded?.(dataUri)
      return dataUri
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload image'
      if (message.toLowerCase().includes('permission')) {
        setError('Photo library access denied')
      } else {
        setError(message)
      }
      return null
    } finally {
      setIsUploading(false)
    }
  }

  return { uploadAvatar, isUploading, error, clearError }
}
