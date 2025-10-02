import { generateAndStoreCharacterImage } from "../services/imageStorageService"

interface GenerateImageArgs {
  text: string
  characterId: string
  userId?: string
}

export const generateImage = async ({ text, characterId, userId }: GenerateImageArgs) => {
  try {
    // Use the current user if not provided
    if (!userId) {
      // This would come from your auth context
      throw new Error('User ID is required for image generation')
    }

    // Generate and store the image with optimized settings
    const result = await generateAndStoreCharacterImage({
      prompt: text,
      characterId,
      userId,
      width: 200,
      height: 200,
      maxFileSizeKB: 140,
      quality: 85
    })

    // Return the public URL for backward compatibility
    return result.publicUrl
  } catch (error) {
    console.error('Error in generateImage utility:', error)
    throw error
  }
}
