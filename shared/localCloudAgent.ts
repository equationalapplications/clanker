import { DEV_CLOUD_CHARACTER_ID } from './dev-sandbox'

function isDevBuild(): boolean {
  if (typeof __DEV__ !== 'undefined' && __DEV__) return true
  const nodeEnv = process.env.NODE_ENV
  return nodeEnv === 'development' || nodeEnv === 'test'
}

/** Private IPv4 ranges and loopback — typical local Docker cloud-agent hosts. */
const LOCAL_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /\.local$/i,
]

function normalizeCloudAgentBaseUrl(rawUrl: string): string {
  return rawUrl
    .trim()
    .replace(/\/agent\/(run|stream|live)\/?$/i, '')
    .replace(/\/$/, '')
}

export function isLocalCloudAgentUrl(baseUrl?: string): boolean {
  const raw = baseUrl ?? process.env.EXPO_PUBLIC_CLOUD_AGENT_URL ?? ''
  if (!raw.trim()) return false

  try {
    const parsed = new URL(normalizeCloudAgentBaseUrl(raw))
    const host = parsed.hostname
    return LOCAL_HOST_PATTERNS.some((pattern) => pattern.test(host))
  } catch {
    return false
  }
}

/**
 * In dev builds pointed at local Docker, route cloud-agent calls to the seeded
 * DEV_CLOUD_CHARACTER_ID so escalation/live voice work without seeding prod IDs.
 */
export function resolveCloudAgentCharacterId(characterId: string): string {
  if (!isDevBuild() || !isLocalCloudAgentUrl()) {
    return characterId
  }
  return DEV_CLOUD_CHARACTER_ID
}
