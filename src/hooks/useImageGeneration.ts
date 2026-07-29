import { useState } from 'react'
import { useAuthMachine, useCharacterMachine } from '~/hooks/useMachines'
import { generateImageViaCallable } from '~/services/imageGenerationService'
import { getCurrentUser } from '~/config/firebaseConfig'
import { saveCharacterImage } from '~/services/characterImageService'
import { MASTER_DIMENSION } from '~/services/imageVariants'
import { usageSnapshotFromError } from '~/services/usageSnapshot'

interface UseImageGenerationProps {
  characterId: string
  /** Receives the new `character_images` row id. */
  onImageGenerated?: (imageId: string) => void
}

interface UseImageGenerationReturn {
  generateImage: (prompt: string) => Promise<string | null>
  isGenerating: boolean
  error: string | null
  clearError: () => void
}

/**
 * Hook that generates a character avatar via secure callable function, saves
 * it into the character_images gallery, and returns the new row id.
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

      // Checked before the callable, not after: generateImageViaCallable spends
      // credits, so failing on a missing uid afterwards would throw away an
      // image the user has already paid for.
      const userId = getCurrentUser()?.uid
      if (!userId) throw new Error('You must be signed in to generate an image')

      const generated = await generateImageViaCallable(prompt)

      // generateImage itself is unchanged — the model returns base64 and the
      // client decides where it lands. Vision reuses this same seam later.
      const row = await saveCharacterImage({
        characterId,
        userId,
        uri: `data:${generated.mimeType};base64,${generated.imageBase64}`,
        // The callable returns bytes only, no dimensions. MASTER_DIMENSION is
        // the model's output size, and these two numbers only decide whether
        // prepareImageVariants downscales — at this value it re-encodes without
        // resizing, which is correct for a 1024 source and never upscales a
        // smaller one.
        width: MASTER_DIMENSION,
        height: MASTER_DIMENSION,
        source: 'generated',
      })

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

      onImageGenerated?.(row.id)
      return row.id
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
