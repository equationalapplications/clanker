import { auth } from '~/config/firebaseConfig'
import type { Content } from '@google/genai'

export interface CloudAgentUnsyncedTask {
  type: 'task'
  id: string
  title: string
  status: string
  createdAt: number
}

export interface CloudAgentPayload {
  message: string
  characterId: string
  history?: Content[]
  unsyncedHistory?: CloudAgentUnsyncedTask[]
}

export interface CloudAgentResult {
  reply: string
  toolCalls: string[]
  usageSnapshot: { remainingCredits: number } | null
}

export async function callCloudAgent(payload: CloudAgentPayload): Promise<CloudAgentResult> {
  const baseUrl = process.env.EXPO_PUBLIC_CLOUD_AGENT_URL?.trim()
  if (!baseUrl) throw new Error('EXPO_PUBLIC_CLOUD_AGENT_URL is not configured')
  const url = `${baseUrl.replace(/\/agent\/run\/?$/, '').replace(/\/$/, '')}/agent/run`

  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new Error('No authenticated user')

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  if (response.status === 402) {
    throw new Error('CLOUD_AGENT_INSUFFICIENT_CREDITS')
  }

  if (!response.ok) {
    throw new Error(`Cloud Agent responded with ${response.status}`)
  }

  const data = (await response.json()) as {
    reply?: string
    toolCalls?: string[]
    usageSnapshot?: { remainingCredits?: unknown } | null
  }

  if (!data.reply || typeof data.reply !== 'string') {
    throw new Error('Invalid Cloud Agent response')
  }

  const rawSnapshot = data.usageSnapshot
  const usageSnapshot =
    rawSnapshot !== null &&
    rawSnapshot !== undefined &&
    typeof rawSnapshot.remainingCredits === 'number'
      ? { remainingCredits: rawSnapshot.remainingCredits }
      : null

  return {
    reply: data.reply,
    toolCalls: data.toolCalls ?? [],
    usageSnapshot,
  }
}
