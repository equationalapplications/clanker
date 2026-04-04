import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { generateImageWithVertexAI } from '~/services/vertexAIService'
import { saveCharacterImageLocally } from '~/services/localImageStorageService'
import { characterKeys } from '~/hooks/useCharacters'

interface UseLocalImageGenerationProps {
  characterId: string
  onImageGenerated?: (dataUri: string) => void
}

interface UseLocalImageGenerationReturn {
  generateImage: (prompt: string) => Promise<string | null>
  isGenerating: boolean
  error: string | null
  clearError: () => void
}

/**
 * Hook that generates a character avatar via Vertex AI, saves the base64 data
 * into SQLite avatar_data, and returns a data URI for immediate display.
 * The canonical `avatar` field is NOT touched — it stays reserved for cloud URLs.
 */
export function useLocalImageGeneration({
  characterId,
  onImageGenerated,
}: UseLocalImageGenerationProps): UseLocalImageGenerationReturn {
  const queryClient = useQueryClient()
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearError = () => setError(null)

  const generateImage = async (prompt: string): Promise<string | null> => {
    if (!prompt.trim()) {
      setError('Please provide a description for the image')
      return null
    }

    setIsGenerating(true)
    setError(null)

    try {
      console.log('🎨 Generating local image for character:', characterId)

      // 1. Generate image — returns raw base64 data
      const base64Data = await generateImageWithVertexAI({
        prompt: prompt.trim(),
        width: 200,
        height: 200,
        outputFormat: 'webp',
      })

      // 2. Persist base64 to SQLite avatar_data column (async)
      const dataUri = await saveCharacterImageLocally(characterId, base64Data)

      console.log('✅ Local image generation complete:', characterId)

      // 3. Invalidate React Query caches so lists/details reflect the new avatar
      await queryClient.invalidateQueries({ queryKey: characterKeys.all })

      onImageGenerated?.(dataUri)
      return dataUri
    } catch (err) {
      const e = err instanceof Error ? err : new Error('Unknown error occurred')
      console.error('Error generating local image:', e)
      setError(e.message)
      return null
    } finally {
      setIsGenerating(false)
    }
  }

  return { generateImage, isGenerating, error, clearError }
}
