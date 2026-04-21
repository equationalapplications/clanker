import { useState } from 'react'
import { useAuthMachine, useCharacterMachine } from '~/hooks/useMachines'
import { generateImageViaCallable } from '~/services/imageGenerationService'
import { saveCharacterImageLocally } from '~/services/localImageStorageService'
import { usageSnapshotFromError } from '~/services/usageSnapshot'

interface UseImageGenerationProps {
  characterId: string
  onImageGenerated?: (dataUri: string) => void
}

interface UseImageGenerationReturn {
  generateImage: (prompt: string) => Promise<string | null>
  isGenerating: boolean
  error: string | null
  clearError: () => void
}

/**
 * Hook that generates a character avatar via secure callable function, saves
 * base64 data into SQLite avatar_data, and returns a data URI for display.
 */
export function useImageGeneration({
  characterId,
  onImageGenerated,
}: UseImageGenerationProps): UseImageGenerationReturn {
  const characterService = useCharacterMachine()
  const authService = useAuthMachine()
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

      const generated = await generateImageViaCallable(prompt)
      const dataUri = await saveCharacterImageLocally(
        characterId,
        generated.imageBase64,
        generated.mimeType,
      )

      console.log('✅ Local image generation complete:', {
        characterId,
        planTier: generated.planTier,
        creditsSpent: generated.creditsSpent,
      })

      authService.send({
        type: 'USAGE_SNAPSHOT_RECEIVED',
        source: 'generateImage',
        remainingCredits: generated.remainingCredits,
        planTier: generated.planTier,
        planStatus: generated.planStatus,
        verifiedAt: generated.verifiedAt,
      })

      characterService.send({ type: 'LOAD' })

      onImageGenerated?.(dataUri)
      return dataUri
    } catch (err) {
      const usageSnapshot = usageSnapshotFromError(err)
      if (usageSnapshot) {
        authService.send({
          type: 'USAGE_SNAPSHOT_RECEIVED',
          source: 'generateImage',
          remainingCredits: usageSnapshot.remainingCredits,
          planTier: usageSnapshot.planTier,
          planStatus: usageSnapshot.planStatus,
          verifiedAt: usageSnapshot.verifiedAt,
        })
      }

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
