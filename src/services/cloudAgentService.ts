import {
  getCloudAgentBaseUrl,
  isLocalCloudAgentUrl,
  resolveCloudAgentCharacterId,
} from '../../shared/localCloudAgent'
import {
  GCP_CREDENTIALS_DEV_CONSOLE_HINT,
  GCP_CREDENTIALS_EXPIRED_CODE,
  isLikelyGcpCredentialsError,
} from '../../shared/gcpCredentialsDev'
import type { AttachmentMimeType } from '../../shared/cloudAgentAttachments'
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

export interface CloudAgentAttachment {
  mimeType: AttachmentMimeType
  /** Base64 of the 1024px master. Never logged — this is user photo content. */
  data: string
}

export interface CloudAgentPayload {
  message: string
  characterId: string
  history?: Content[]
  unsyncedHistory?: CloudAgentUnsyncedTask[]
  /** At most one in Phase 2 (MAX_ATTACHMENTS_PER_TURN). */
  attachments?: CloudAgentAttachment[]
}

export interface CloudAgentResult {
  reply: string
  toolCalls: string[]
  usageSnapshot: { remainingCredits: number } | null
  groundingMetadata?: GroundingMetadata
}

export interface AgentImagePayload {
  imageBase64: string
  mimeType: string
}

export interface CloudAgentStreamCallbacks {
  onToken?: (text: string) => void
  onToolStart?: (name: string) => void
  onToolEnd?: (name: string) => void
  /** Fires once when the agent generated an image this turn (either transport). */
  onAgentImage?: (image: AgentImagePayload) => void
}

// Must outlast a Cloud Run cold start (~7.5s observed) or the first message of a
// session always stalls out and falls back to HTTP.
const WS_CONNECT_TIMEOUT_MS = 10_000
// After a transport-level WS failure (connect error/timeout), go straight to HTTP
// for this long so a WS-blocked network pays the connect wait once, not per message.
const WS_RETRY_COOLDOWN_MS = 60_000

let wsDisabledUntil = 0

function isClientDevBuild(): boolean {
  if (typeof __DEV__ !== 'undefined') return __DEV__
  return process.env.NODE_ENV !== 'production'
}

/** Dev-only: log actionable hints when local cloud-agent fails on Vertex AI auth. */
export function warnCloudAgentDevHint(errorOrMessage: unknown, code?: string): void {
  if (!isClientDevBuild() || !isLocalCloudAgentUrl()) return

  if (code === GCP_CREDENTIALS_EXPIRED_CODE || isLikelyGcpCredentialsError(errorOrMessage)) {
    console.warn(`[Dev] ${GCP_CREDENTIALS_DEV_CONSOLE_HINT}`)
    return
  }

  const message = typeof errorOrMessage === 'string' ? errorOrMessage : ''
  if (code === 'INTERNAL_ERROR' && message === 'Agent execution failed') {
    console.warn(
      '[Dev] Local cloud-agent failed during agent execution. ' +
        'Expired Vertex AI credentials are a common cause. Try:\n' +
        '  gcloud auth application-default login\n' +
        '  gcloud auth application-default set-quota-project clanker-prod\n' +
        '  GCP_PROJECT=clanker-prod docker compose -f docker-compose.local.yml restart cloud-agent',
    )
  }
}

function mapWebSocketError(code: string, message: string): Error {
  warnCloudAgentDevHint(message, code)
  if (code === 'INSUFFICIENT_CREDITS') {
    return new Error('CLOUD_AGENT_INSUFFICIENT_CREDITS')
  }
  return new Error(`WebSocket error: ${code} - ${message}`)
}

export async function runViaHttp(
  payload: CloudAgentPayload,
  callbacks?: CloudAgentStreamCallbacks,
): Promise<CloudAgentResult> {
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
    let errorBody: { error?: string; code?: string; message?: string } | null = null
    try {
      errorBody = (await response.json()) as { error?: string; code?: string; message?: string }
    } catch {
      errorBody = null
    }
    warnCloudAgentDevHint(
      errorBody?.code === 'INTERNAL_ERROR'
        ? (errorBody?.message ?? errorBody?.error)
        : (errorBody?.error ?? errorBody?.message),
      errorBody?.code,
    )
    throw new Error(`Cloud Agent responded with ${response.status}`)
  }

  const data = (await response.json()) as {
    reply?: string
    toolCalls?: string[]
    usageSnapshot?: { remainingCredits?: unknown } | null
    groundingMetadata?: unknown
    generatedImage?: unknown
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

  const rawImage = data.generatedImage as AgentImagePayload | null | undefined
  if (
    rawImage &&
    typeof rawImage.imageBase64 === 'string' &&
    typeof rawImage.mimeType === 'string'
  ) {
    callbacks?.onAgentImage?.({ imageBase64: rawImage.imageBase64, mimeType: rawImage.mimeType })
  }

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

  const { message, characterId, history = [], unsyncedHistory = [], attachments } = payload
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const wsUrl = `${getCloudAgentBaseUrl().replace(/^https?/, (m) => (m === 'https' ? 'wss' : 'ws'))}/agent/stream`

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let reply = ''
    const toolCalls: string[] = []
    let groundingMetadata: GroundingMetadata | undefined
    let usageSnapshot: { remainingCredits: number } | null = null
    let settled = false
    let connectTimeout: ReturnType<typeof setTimeout>

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(connectTimeout)
      ws.removeEventListener('open', handleOpen)
      ws.removeEventListener('message', handleMessage)
      ws.removeEventListener('error', handleError)
      ws.removeEventListener('close', handleClose)
      fn()
    }

    const handleClose = (event: Event) => {
      if (settled) return
      settle(() => {
        if (!usageSnapshot) {
          const closeEvent = event as CloseEvent
          if (closeEvent.code === 4001) {
            reject(new Error('WebSocket auth timeout'))
            return
          }
          reject(new Error('WebSocket closed before receiving usage_snapshot'))
          return
        }
        resolve({ reply, toolCalls, usageSnapshot, groundingMetadata })
      })
    }

    const handleOpen = () => {
      clearTimeout(connectTimeout)
      ws.send(JSON.stringify({ type: 'auth', token }))
      ws.send(
        JSON.stringify({
          type: 'agent_run',
          message,
          characterId,
          history,
          unsyncedHistory,
          timezone,
          attachments,
        }),
      )
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
          imageBase64?: unknown
          mimeType?: unknown
        }

        if (msg.type === 'error') {
          settle(() => {
            try {
              ws.close()
            } catch {
              /* ignore */
            }
            reject(mapWebSocketError(msg.code ?? 'UNKNOWN', msg.message ?? 'Unknown error'))
          })
          return
        }

        clearTimeout(connectTimeout)

        if (msg.type === 'tool_start' && msg.name && !toolCalls.includes(msg.name)) {
          toolCalls.push(msg.name)
          callbacks?.onToolStart?.(msg.name)
        } else if (msg.type === 'tool_end' && msg.name) {
          callbacks?.onToolEnd?.(msg.name)
        } else if (msg.type === 'token' && msg.text) {
          reply += msg.text
          callbacks?.onToken?.(msg.text)
        } else if (msg.type === 'grounding_metadata') {
          const parsed = parseGroundingMetadata(
            (msg as { groundingMetadata?: unknown }).groundingMetadata,
          )
          if (parsed) {
            groundingMetadata = parsed
          }
        } else if (msg.type === 'agent_image') {
          // Unknown-frame tolerance keeps old servers safe; malformed payloads are
          // dropped rather than trusted.
          if (typeof msg.imageBase64 === 'string' && typeof msg.mimeType === 'string') {
            callbacks?.onAgentImage?.({
              imageBase64: msg.imageBase64,
              mimeType: msg.mimeType as string,
            })
          }
        } else if (msg.type === 'usage_snapshot') {
          const remaining = msg.remainingCredits
          usageSnapshot =
            typeof remaining === 'number' && Number.isInteger(remaining) && remaining >= 0
              ? { remainingCredits: remaining }
              : null
        }
      } catch (err) {
        settle(() => {
          try {
            ws.close()
          } catch {
            /* ignore */
          }
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
    connectTimeout = setTimeout(() => {
      settle(() => {
        try {
          ws.close()
        } catch {
          /* ignore */
        }
        reject(new Error('WebSocket connection timeout'))
      })
    }, WS_CONNECT_TIMEOUT_MS)
  })
}

export async function callCloudAgent(
  payload: CloudAgentPayload,
  callbacks?: CloudAgentStreamCallbacks,
): Promise<CloudAgentResult> {
  const resolvedPayload: CloudAgentPayload = {
    ...payload,
    characterId: resolveCloudAgentCharacterId(payload.characterId),
  }

  if (Date.now() < wsDisabledUntil) {
    return await runViaHttp(resolvedPayload, callbacks)
  }

  try {
    return await runViaWebSocket(resolvedPayload, callbacks)
  } catch (wsErr) {
    const msg = wsErr instanceof Error ? wsErr.message : String(wsErr)
    const isTransportFailure =
      msg === 'WebSocket connection error' || msg === 'WebSocket connection timeout'
    const shouldFallbackToHttp =
      isTransportFailure ||
      msg === 'WebSocket auth timeout' ||
      msg.startsWith('WebSocket error: UNAUTHORIZED')

    if (!shouldFallbackToHttp) throw wsErr

    if (isTransportFailure) {
      wsDisabledUntil = Date.now() + WS_RETRY_COOLDOWN_MS
    }
    console.warn('WebSocket failed, falling back to HTTP:', wsErr)
    return await runViaHttp(resolvedPayload, callbacks)
  }
}
