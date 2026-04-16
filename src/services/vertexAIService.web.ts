import { getAI, getGenerativeModel, VertexAIBackend, ResponseModality } from 'firebase/ai'
import { firebaseApp } from '~/config/firebaseConfig'

// Initialize AI with Vertex AI backend
const ai = getAI(firebaseApp, {
  backend: new VertexAIBackend(), // Use Vertex AI backend
})

// Initialize the generative model for images
const imageModel = getGenerativeModel(ai, {
  model: 'gemini-2.5-flash-image', // Nano Banana - replaces deprecated Imagen models
  generationConfig: {
    responseModalities: [ResponseModality.TEXT, ResponseModality.IMAGE],
  },
})

export interface ImageGenerationOptions {
  prompt: string
  width?: number
  height?: number
  aspectRatio?: '1:1' | '9:16' | '16:9' | '4:3' | '3:4'
  stylePreset?: string
  outputFormat?: 'png' | 'webp' | 'jpeg'
}

/**
 * Generate an image using Vertex AI Imagen model
 * Optimized for small avatar images
 */
export const generateImageWithVertexAI = async ({
  prompt,
  width = 200,
  height = 200,
  aspectRatio = '1:1',
  stylePreset,
  outputFormat = 'webp',
}: ImageGenerationOptions): Promise<string> => {
  try {
    console.log('🎨 Generating optimized image with Vertex AI Imagen:', {
      prompt,
      width,
      height,
      aspectRatio,
      outputFormat,
    })

    // Optimize prompt for small avatar images
    // Note: Gemini image models don't support explicit width/height/aspectRatio params;
    // describe desired dimensions in the prompt instead, using the caller-provided options.
    const sizeDescriptionParts: string[] = []
    if (width && height) {
      sizeDescriptionParts.push(`approximately ${width}x${height} pixels`)
    }
    if (aspectRatio) {
      sizeDescriptionParts.push(`${aspectRatio} aspect ratio`)
    }
    const sizeDescription =
      sizeDescriptionParts.length > 0 ? sizeDescriptionParts.join(', ') : 'small avatar size'

    const styleDescription = stylePreset
      ? `Art style: ${stylePreset}.`
      : 'Professional digital art style.'

    const formatDescription = outputFormat
      ? `Optimized for use as a ${outputFormat} avatar image.`
      : 'Optimized for small avatar display.'

    const enhancedPrompt = `High-quality character avatar portrait: ${prompt}. ${sizeDescription}. Clean, simple background. Focused on face and upper body. ${styleDescription} Sharp details, vibrant colors. ${formatDescription}`

    // Generate image using Vertex AI (responseModalities configured at model level)
    const result = await imageModel.generateContent(enhancedPrompt)
    const response = await result.response

    // Extract the image data from the response (Gemini image models return inlineData parts)
    const candidate = response.candidates?.[0]
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData?.data) {
          console.log('✅ Image generated successfully with Vertex AI')
          return part.inlineData.data
        }
      }
    }

    throw new Error('No image data found in Vertex AI response')
  } catch (error) {
    console.error('Error generating image with Vertex AI:', error)
    throw new Error(
      `Image generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

export { imageModel, ai }
