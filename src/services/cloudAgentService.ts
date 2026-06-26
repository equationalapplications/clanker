import { getCurrentUser } from '~/config/firebaseConfig'
import { parseGroundingMetadata } from '~/services/groundingMetadata'
import type { Content, GroundingMetadata } from '@google/genai'

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
  groundingMetadata?: GroundingMetadata
}

export interface CloudAgentStreamCallbacks {
  onToken?: (text: string) => void
  onToolStart?: (name: string) => void
  onToolEnd?: (name: string) => void
}

const AUTH_TIMEOUT_MS = 5000

function getCloudAgentBaseUrl(): string {
  const baseUrl = process.env.EXPO_PUBLIC_CLOUD_AGENT_URL?.trim()
  if (!baseUrl) throw new Error('EXPO_PUBLIC_CLOUD_AGENT_URL is not configured')
  return baseUrl.replace(/\/agent\/run\/?$/, '').replace(/\/$/, '')
}

function mapWebSocketError(code: string, message: string): Error {
  if (code === 'INSUFFICIENT_CREDITS') {
    return new Error('CLOUD_AGENT_INSUFFICIENT_CREDITS')
  }
  return new Error(`WebSocket error: ${code} - ${message}`)
}

export async function runViaHttp(payload: CloudAgentPayload): Promise<CloudAgentResult> {
  const url = `${getCloudAgentBaseUrl()}/agent/run`

  const token = await getCurrentUser()?.getIdToken()
  if (!token) throw new Error('No authenticated user')

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Timezone': Intl.DateTimeFormat().resolvedOptions().timeZone,
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
    groundingMetadata?: unknown
  }

  if (!data.reply || typeof data.reply !== 'string') {
    throw new Error('Invalid Cloud Agent response')
  }

  const remainingCredits = data.usageSnapshot?.remainingCredits
  const usageSnapshot =
    typeof remainingCredits === 'number' &&
    Number.isInteger(remainingCredits) &&
    remainingCredits >= 0
      ? { remainingCredits }
      : null

  return {
    reply: data.reply,
    toolCalls: data.toolCalls ?? [],
    usageSnapshot,
    groundingMetadata: parseGroundingMetadata(data.groundingMetadata),
  }
}

async function runViaWebSocket(
  payload: CloudAgentPayload,
  callbacks?: CloudAgentStreamCallbacks,
): Promise<CloudAgentResult> {
  const token = await getCurrentUser()?.getIdToken()
  if (!token) throw new Error('No authenticated user')

  const { message, characterId, history = [], unsyncedHistory = [] } = payload
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const wsUrl = `${getCloudAgentBaseUrl().replace(/^https?/, (m) => (m === 'https' ? 'wss' : 'ws'))}/agent/stream`

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let reply = ''
    const toolCalls: string[] = []
    let usageSnapshot: { remainingCredits: number } | null = null
    let settled = false
    let authTimeout: ReturnType<typeof setTimeout>

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(authTimeout)
      ws.removeEventListener('open', handleOpen)
      ws.removeEventListener('message', handleMessage)
      ws.removeEventListener('error', handleError)
      ws.removeEventListener('close', handleClose)
      fn()
    }

    const handleClose = () => {
      if (settled) return
      settle(() => {
        if (!usageSnapshot) {
          reject(new Error('WebSocket closed before receiving usage_snapshot'))
          return
        }
        resolve({ reply, toolCalls, usageSnapshot })
      })
    }

    const handleOpen = () => {
      clearTimeout(authTimeout)
      ws.send(JSON.stringify({ type: 'auth', token }))
      ws.send(JSON.stringify({
        type: 'agent_run',
        message,
        characterId,
        history,
        unsyncedHistory,
        timezone,
      }))
    }

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          type: string
          code?: string
          message?: string
          name?: string
          text?: string
          remainingCredits?: number
        }

        if (msg.type === 'error') {
          settle(() => {
            try { ws.close() } catch { /* ignore */ }
            reject(mapWebSocketError(msg.code ?? 'UNKNOWN', msg.message ?? 'Unknown error'))
          })
          return
        }

        clearTimeout(authTimeout)

        if (msg.type === 'tool_start' && msg.name && !toolCalls.includes(msg.name)) {
          toolCalls.push(msg.name)
          callbacks?.onToolStart?.(msg.name)
        } else if (msg.type === 'tool_end' && msg.name) {
          callbacks?.onToolEnd?.(msg.name)
        } else if (msg.type === 'token' && msg.text) {
          reply += msg.text
          callbacks?.onToken?.(msg.text)
        } else if (msg.type === 'usage_snapshot') {
          const remaining = msg.remainingCredits
          usageSnapshot =
            typeof remaining === 'number' && Number.isInteger(remaining) && remaining >= 0
              ? { remainingCredits: remaining }
              : null
        }
      } catch (err) {
        settle(() => {
          try { ws.close() } catch { /* ignore */ }
          reject(new Error(`Failed to parse WebSocket message: ${err}`))
        })
      }
    }

    const handleError = () => {
      settle(() => reject(new Error('WebSocket connection error')))
    }

    ws.addEventListener('open', handleOpen)
    ws.addEventListener('message', handleMessage)
    ws.addEventListener('error', handleError)
    ws.addEventListener('close', handleClose)

    // Guard against sockets that never reach `open`.
    authTimeout = setTimeout(() => {
      settle(() => {
        try { ws.close() } catch { /* ignore */ }
        reject(new Error('WebSocket connection timeout'))
      })
    }, AUTH_TIMEOUT_MS)
  })
}

export async function callCloudAgent(
  payload: CloudAgentPayload,
  callbacks?: CloudAgentStreamCallbacks,
): Promise<CloudAgentResult> {
  try {
    return await runViaWebSocket(payload, callbacks)
  } catch (wsErr) {
    const msg = wsErr instanceof Error ? wsErr.message : String(wsErr)
    const shouldFallbackToHttp =
      msg === 'WebSocket connection error' ||
      msg === 'WebSocket connection timeout' ||
      msg === 'WebSocket auth timeout' ||
      msg.startsWith('WebSocket error: UNAUTHORIZED')

    if (!shouldFallbackToHttp) throw wsErr

    console.warn('WebSocket failed, falling back to HTTP:', wsErr)
    return await runViaHttp(payload)
  }
}
