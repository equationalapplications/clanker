import { useState } from 'react'
import { generateAndStoreCharacterImage, updateCharacterAvatar } from '~/services/imageStorageService'

interface UseImageGenerationProps {
    characterId: string
    userId: string
    onImageGenerated?: (imageUrl: string) => void
    onError?: (error: Error) => void
}

interface UseImageGenerationReturn {
    generateImage: (prompt: string) => Promise<string | null>
    isGenerating: boolean
    error: string | null
    clearError: () => void
}

/**
 * Hook for generating and storing character images
 */
export function useImageGeneration({
    characterId,
    userId,
    onImageGenerated,
    onError
}: UseImageGenerationProps): UseImageGenerationReturn {
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
            console.log('🎨 Starting image generation for character:', characterId)

            // Generate and store the image with optimized settings for small avatars
            const result = await generateAndStoreCharacterImage({
                prompt: prompt.trim(),
                characterId,
                userId,
                width: 200,
                height: 200,
                maxFileSizeKB: 140,
                quality: 85
            })

            // Update the character's avatar URL in the database
            await updateCharacterAvatar(characterId, result.publicUrl)

            console.log('✅ Image generation and storage complete:', result.publicUrl)

            // Call the callback if provided
            onImageGenerated?.(result.publicUrl)

            return result.publicUrl
        } catch (err) {
            const error = err instanceof Error ? err : new Error('Unknown error occurred')
            console.error('Error generating image:', error)

            setError(error.message)
            onError?.(error)

            return null
        } finally {
            setIsGenerating(false)
        }
    }

    return {
        generateImage,
        isGenerating,
        error,
        clearError
    }
}

/**
 * Hook for managing character avatars with generation capabilities
 */
export function useCharacterAvatar(characterId: string, userId: string, initialAvatar?: string) {
    const [avatar, setAvatar] = useState(initialAvatar || '')
    const [error, setError] = useState<string | null>(null)

    const imageGeneration = useImageGeneration({
        characterId,
        userId,
        onImageGenerated: (imageUrl) => {
            setAvatar(imageUrl)
            setError(null)
        },
        onError: (err) => {
            setError(err.message)
        }
    })

    const generateAvatar = async (prompt: string) => {
        return await imageGeneration.generateImage(prompt)
    }

    const updateAvatar = (newAvatar: string) => {
        setAvatar(newAvatar)
    }

    const clearError = () => {
        setError(null)
        imageGeneration.clearError()
    }

    return {
        avatar,
        updateAvatar,
        generateAvatar,
        isGenerating: imageGeneration.isGenerating,
        error: error || imageGeneration.error,
        clearError
    }
}