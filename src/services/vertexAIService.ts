import { getAI, getGenerativeModel, VertexAIBackend } from 'firebase/ai'
import { app } from '../config/firebaseConfig'

// Initialize AI with Vertex AI backend  
const ai = getAI(app, {
    backend: new VertexAIBackend(), // Use Vertex AI backend
})

// Initialize the generative model
const model = getGenerativeModel(ai, {
    model: 'gemini-2.5-flash', // Using Gemini model
})

export interface ChatContext {
    characterName: string
    characterPersonality: string
    characterTraits: string
    conversationHistory: Array<{
        role: 'user' | 'assistant'
        content: string
    }>
}

/**
 * Generate an AI response for chat using Vertex AI
 */
export const generateChatResponse = async (
    userMessage: string,
    context: ChatContext
): Promise<string> => {
    try {
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
${context.conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

User: ${userMessage}
${context.characterName}:`

        // Generate response using Vertex AI
        const result = await model.generateContent(systemPrompt)
        const response = await result.response
        const text = response.text()

        if (!text) {
            throw new Error('Empty response from AI model')
        }

        return text.trim()

    } catch (error) {
        console.error('Error generating AI response:', error)

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
    characterTraits: string
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

        const result = await model.generateContent(prompt)
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

export { model, ai }