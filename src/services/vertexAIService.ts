import { getAI, getGenerativeModel, VertexAIBackend } from 'firebase/ai'
import { app } from '~/config/firebaseConfig'

// Initialize AI with Vertex AI backend
const ai = getAI(app, {
  backend: new VertexAIBackend(), // Use Vertex AI backend
})

// Initialize the generative model for text
const textModel = getGenerativeModel(ai, {
  model: 'gemini-2.5-flash', // Using Gemini model for text
})

// Initialize the generative model for images
const imageModel = getGenerativeModel(ai, {
  model: 'imagen-3.0-generate-001', // Using Imagen model for image generation
})

export interface ChatContext {
  characterName: string
  characterPersonality: string
  characterTraits: string
  conversationHistory: {
    role: 'user' | 'assistant'
    content: string
  }[]
}

/**
 * Generate an AI response for chat using Vertex AI
 */
export const generateChatResponse = async (
  userMessage: string,
  context: ChatContext,
): Promise<string> => {
  try {
    console.log('🤖 Generating AI response with context:', {
      characterName: context.characterName,
      userMessage,
      historyLength: context.conversationHistory.length,
    })

    // Build the prompt with character context
    const systemPrompt = `You are ${context.characterName}, a virtual friend chatbot with the following personality:

Personality: ${context.characterPersonality}
Traits: ${context.characterTraits}

Instructions:
- Respond as ${context.characterName} would, staying true to the personality and traits
- Keep responses conversational and engaging
- Respond naturally and authentically to the user's message
- Don't break character or mention that you're an AI
- Keep responses reasonably brief (1-3 sentences unless the conversation calls for more)

Conversation history:
${context.conversationHistory.map((msg) => `${msg.role}: ${msg.content}`).join('\n')}

User: ${userMessage}
${context.characterName}:`

    console.log('📝 Generated prompt, calling Vertex AI...')

    // Generate response using Vertex AI
    const result = await textModel.generateContent(systemPrompt)
    const response = await result.response
    const text = response.text()

    console.log('✅ Received AI response:', text?.substring(0, 100))

    if (!text) {
      throw new Error('Empty response from AI model')
    }

    return text.trim()
  } catch (error) {
    console.error('❌ Error generating AI response:', error)
    console.error('Error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    // Return a fallback message that stays in character
    return `I'm having trouble thinking of what to say right now. Could you tell me more about what's on your mind?`
  }
}

/**
 * Generate a character introduction message
 */
export const generateCharacterIntroduction = async (
  characterName: string,
  characterPersonality: string,
  characterTraits: string,
): Promise<string> => {
  try {
    const prompt = `You are ${characterName}, a virtual friend chatbot. This is your first message to a new user.

Your personality: ${characterPersonality}
Your traits: ${characterTraits}

Generate a friendly, warm introduction message that:
- Introduces yourself as ${characterName}
- Shows your personality
- Invites the user to start a conversation
- Keep it brief and welcoming (1-2 sentences)

Introduction:`

    const result = await textModel.generateContent(prompt)
    const response = await result.response
    const text = response.text()

    if (!text) {
      throw new Error('Empty response from AI model')
    }

    return text.trim()
  } catch (error) {
    console.error('Error generating character introduction:', error)
    return `Hi! I'm ${characterName}. I'm excited to chat with you!`
  }
}

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

    // Create the generation request optimized for small images
    const generationConfig = {
      candidateCount: 1,
      width,
      height,
      aspectRatio,
      outputMimeType: `image/${outputFormat}`,
      ...(stylePreset && { stylePreset }),
    }

    // Generate image using Vertex AI
    const result = await imageModel.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: enhancedPrompt }],
        },
      ],
      generationConfig,
    })

    const response = await result.response

    // Extract the image data from the response
    // Note: The exact response format may vary based on the Imagen model
    if (response.candidates && response.candidates[0]) {
      const candidate = response.candidates[0]

      // Check if the response contains image data
      if (candidate.content && candidate.content.parts) {
        for (const part of candidate.content.parts) {
          if (part.inlineData && part.inlineData.data) {
            console.log('✅ Image generated successfully with Vertex AI')
            return part.inlineData.data
          }
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

export { textModel, imageModel, ai }
