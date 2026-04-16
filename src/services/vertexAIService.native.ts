// Native version - uses React Native Firebase AI module
import { getApp } from '@react-native-firebase/app'
import { getAI, getGenerativeModel, VertexAIBackend, ResponseModality } from '@react-native-firebase/ai'
import { appCheckReady } from '~/config/firebaseConfig'

// Initialize AI with Vertex AI backend
const app = getApp()
const ai = getAI(app, { backend: new VertexAIBackend() })

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
        const enhancedPrompt = `High-quality character avatar portrait: ${prompt}. Clean, simple background. Focused on face and upper body. Professional digital art style, sharp details, vibrant colors. Optimized for small avatar display.`

        // // Create the generation request optimized for small images
        // const generationConfig = {
        //     candidateCount: 1,
        //     // Note: React Native Firebase Vertex AI may have different config options
        //     // Adjust these based on the actual API
        // }

        // Generate image using Vertex AI
        await appCheckReady
        const result = await imageModel.generateContent(enhancedPrompt)

        // Extract the image data from the response (Gemini image models return inlineData parts)
        const candidate = result.response.candidates?.[0]
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
