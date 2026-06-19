import { GoogleGenAI } from '@google/genai'
import type { Content, ToolListUnion } from '@google/genai'
import { buildSystemInstruction } from '../CharacterPromptBuilder'
import { agentToolSpec } from '../../../shared/agent-tools-spec'

const character = {
  id: 'eval-char',
  name: 'Aria',
  appearance: 'warm and curious',
  traits: 'empathetic, helpful',
  emotions: 'gentle',
  context: '',
}

const userId = 'eval-user'

const ALL_TOOLS = [
  {
    functionDeclarations: agentToolSpec
      .filter(t => t.tier === 'both' || t.tier === 'edge-only')
      .map(({ name, description, parameters }) => ({ name, description, parameters })),
  },
] as unknown as ToolListUnion

function getProjectId(): string | undefined {
  return [
    process.env.GCLOUD_PROJECT,
    process.env.GCP_PROJECT,
    process.env.GOOGLE_CLOUD_PROJECT,
  ]
    .map(v => v?.trim())
    .find((v): v is string => Boolean(v))
}

async function runEdgeEval(userText: string) {
  const useVertex = process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true'
  const project = getProjectId()
  const location = process.env.GOOGLE_CLOUD_LOCATION?.trim() || 'global'
  const apiKey = process.env.GOOGLE_GENAI_API_KEY

  if (useVertex) {
    if (!project) {
      throw new Error(
        'Missing project env (GCLOUD_PROJECT, GCP_PROJECT, or GOOGLE_CLOUD_PROJECT) for Vertex AI evals',
      )
    }
  } else if (!apiKey) {
    throw new Error(
      'Set GOOGLE_GENAI_API_KEY or enable GOOGLE_GENAI_USE_VERTEXAI=true with a project env var',
    )
  }

  const ai = useVertex
    ? new GoogleGenAI({ vertexai: true, project: project!, location })
    : new GoogleGenAI({ apiKey })
  const systemInstruction = buildSystemInstruction({ character, userId })
  const contents: Content[] = [{ role: 'user', parts: [{ text: userText }] }]

  return ai.models.generateContent({
    model: 'gemini-3.5-flash',
    contents,
    config: {
      systemInstruction,
      tools: ALL_TOOLS,
    },
  })
}

describe('Edge Agent LLM Routing Evals', () => {
  it(
    'Test A: asking about a past fact yields a search_memory tool call',
    async () => {
      const result = await runEdgeEval(
        'Do you remember what my favorite food is? You mentioned it before.',
      )
      const calls = result.functionCalls ?? []
      expect(calls.length).toBeGreaterThan(0)
      expect(calls[0].name).toBe('wiki_read')
    },
    30000,
  )

  it(
    'Test B: asking to write a long essay yields an escalate_to_cloud_agent tool call or a cloud-only escalation response',
    async () => {
      const result = await runEdgeEval(
        'Write me a detailed 2000-word essay about the history of the Roman Empire, covering economic, military, and cultural factors in its rise and fall.',
      )
      const calls = result.functionCalls ?? []
      if (calls.length > 0) {
        expect(calls[0].name).toBe('escalate_to_cloud_agent')
      } else {
        expect(result.text?.toLowerCase()).toMatch(/cloud|escalate|remote server|server-side|more powerful tool|connect(?:s|ed)? you with|transfer(?:red)? you|tool that specializes/)
      }
    },
    30000,
  )

  it(
    'Test C: casual chatting yields a text response with no tool calls',
    async () => {
      const result = await runEdgeEval('How are you today?')
      const calls = result.functionCalls ?? []
      expect(calls.length).toBe(0)
      expect(typeof result.text).toBe('string')
      expect((result.text ?? '').length).toBeGreaterThan(0)
    },
    30000,
  )
})